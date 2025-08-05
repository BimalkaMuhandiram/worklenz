import { IWorkLenzRequest } from "../../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../../interfaces/worklenz-response";
import db from "../../config/db";
import { ServerResponse } from "../../models/server-response";
import HandleExceptions from "../../decorators/handle-exceptions";
import SmartChatControllerBase from "./smart-chat-controller-base";
import { ChatLogCreateSchema, ChatInfoRequestSchema } from "./chat.schema";
import { OpenAIService } from "./openai-service";
import { AppError } from "../../utils/AppError";

function sanitizeSQL(sql: string): string {
  return sql
    .replace(/;\s*$/, "")
    .replace(/INTERVAL\s+'1\s+quarter'/gi, "INTERVAL '3 months'")
    .replace(/INTERVAL\s+'2\s+quarters'/gi, "INTERVAL '6 months'")
    .replace(/INTERVAL\s+'1\s+year'/gi, "INTERVAL '12 months'");
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function fixBrokenGroupBy(sql: string): string {
  const hasGroupBy = /group\s+by/i.test(sql);
  if (!hasGroupBy) return sql;

  const groupByMatch = sql.match(/group\s+by\s+(.+?)(\s+limit|\s+offset|\s+order|\s*$)/i);
  if (!groupByMatch) return sql;

  const groupByFields = groupByMatch[1]
    .split(',')
    .map(f => f.trim().toLowerCase().replace(/["`]/g, ''));

  // Extract SELECT fields
  const selectMatch = sql.match(/select\s+(.+?)\s+from\s+/is);
  if (!selectMatch) return sql;

  const selectFieldsRaw = selectMatch[1];
  const selectFields = selectFieldsRaw.split(',')
    .map(f => {
      const field = f.trim().split(/\s+as\s+/i)[0];
      return field.toLowerCase().replace(/["`]/g, '');
    });

  const requiredGroupFields = selectFields.filter(f =>
    !f.includes('(') && 
    !groupByFields.includes(f)
  );

  if (requiredGroupFields.length === 0) return sql;

  // Rebuild GROUP BY clause
  const allGroupByFields = Array.from(new Set([...groupByFields, ...requiredGroupFields]));
  const newGroupBy = `GROUP BY ${allGroupByFields.join(', ')}`;

  return sql.replace(/group\s+by\s+(.+?)(\s+limit|\s+offset|\s+order|\s*$)/i, `${newGroupBy}$2`);
}

function injectTeamIdFilter(sqlQuery: string, teamIds: string | string[]): string {

  if (/\bteam_id\s*=\s*['"]?[0-9a-f-]{36}['"]?/i.test(sqlQuery) ||
      /\bteam_id\s+IN\s*\(/i.test(sqlQuery)) {
    return sqlQuery; 
  }

  const projectAliasMatch = /(?:join|from)\s+projects\s+(?:as\s+)?(\w+)/i.exec(sqlQuery);
  const alias = projectAliasMatch ? projectAliasMatch[1] : "projects";

  let teamFilter = "";
  if (Array.isArray(teamIds)) {
    const teamList = teamIds.map(id => `'${id}'`).join(", ");
    teamFilter = `${alias}.team_id IN (${teamList})`;
  } else {
    teamFilter = `${alias}.team_id = '${teamIds}'`;
  }

  const whereMatch = sqlQuery.match(/where\s+/i);
  if (whereMatch) {
    return sqlQuery.replace(/where\s+/i, `WHERE ${teamFilter} AND `);
  } else {
    return `${sqlQuery} WHERE ${teamFilter}`;
  }
}

function wrapOrConditionsSafely(sql: string): string {
  return sql.replace(
    /where\s+(.+?)(\s+limit|\s+order|\s+group|\s*$)/is,
    (match, conditions, tail) => {
      if (/ or /i.test(conditions) && !/\(.+\)/s.test(conditions)) {
        return `WHERE (${conditions.trim()})${tail}`;
      }
      return match;
    }
  );
}

function normalizeWhereConditions(sql: string): string {
  return sql.replace(
    /(where\s+)(.*?)(\s+group|\s+order|\s+limit|\s*$)/is,
    (match, whereKeyword, conditions, tail) => {
      const needsWrapping = /\bor\b/i.test(conditions) && /\band\b/i.test(conditions) && !/\(.+\)/s.test(conditions);
      if (needsWrapping) {
        return `${whereKeyword}(${conditions.trim()})${tail}`;
      }
      return match;
    }
  );
}

function addDistinctIfMissing(sql: string): string {
  const hasDistinct = /^select\s+distinct/i.test(sql);
  if (hasDistinct) return sql;

  return sql.replace(/^select\s+/i, "SELECT DISTINCT ");
}

export default class SmartchatController extends SmartChatControllerBase {
  @HandleExceptions()
  public static async create(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const teamId = this.getCurrentTeamId(req);
    const userId = req.user?.id;

    const validation = ChatLogCreateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).send(new ServerResponse(false, validation.error.flatten()));
    }

    const { messages } = validation.data;

    const query = `
      INSERT INTO chat_log (team_id, user_id, messages, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING *;
    `;

    const result = await db.query(query, [teamId, userId, JSON.stringify(messages)]);
    return res.status(200).json(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
public static async getChatInfo(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
  const currentTeamId = this.getCurrentTeamId(req);
  const userId = req.user?.id;

  if (!currentTeamId || !userId) {
    throw new AppError("Team or User ID missing.", 400);
  }

const teamResult = await db.query(
  `SELECT team_id FROM team_members WHERE user_id = $1`,
  [userId]
);

const authorizedTeamIds = teamResult.rows
  .map(row => row.team_id)
  .filter((id: string) => typeof id === "string" && isValidUUID(id));

  const validation = ChatInfoRequestSchema.safeParse(req.body);
  if (!validation.success) {
    throw new AppError("Invalid input data.", 400);
  }

  const { chat: messages } = validation.data;
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    throw new AppError("No messages provided.", 400);
  }

  const userMessage =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : lastMessage.content.map((c) => c.text).join(" ");

  // Step 1: Classify intent
  const intent = await OpenAIService.classifyUserIntent(userMessage);
  console.log(`User intent classified as: ${intent}`);

  // Detect if user wants cross-team info (simple heuristic, customize as needed)
  const wantsMultiTeamInfo = /which teams|all teams|team leaderboard|team ranking/i.test(userMessage);

  if (wantsMultiTeamInfo && authorizedTeamIds.length === 1) {
    // User asked cross-team but only allowed one team
    return res.status(200).json(new ServerResponse(true, {
      answer: "Sorry, you do not have permission to access data across multiple teams.",
      suggestions: ["Try asking about your own team's tasks or projects."]
    }));
  }

  // Step 2: Get schema
  const schema = this.getTableSchema();
  if (!schema) {
    throw new AppError("No schema available.", 400);
  }

  // Step 3: Generate SQL from message
  const queryResponseObj = await this.getSQLQueryFromMessage({
    userMessage,
    userId,
    teamId: wantsMultiTeamInfo ? authorizedTeamIds : currentTeamId,
    schema,
  });

  if (
    !queryResponseObj ||
    typeof queryResponseObj.query !== "string" ||
    queryResponseObj.query.trim() === "" ||
    queryResponseObj.is_query === false
  ) {
    return res.status(200).json(new ServerResponse(true, {
      answer: queryResponseObj?.summary || "Sorry, I couldn’t understand your request.",
      suggestions: ["Try asking about tasks, projects, or team members"]
    }));
  }

  let sqlQuery = sanitizeSQL(queryResponseObj.query.trim());
  console.log("Generated SQL Query:", sqlQuery);

  sqlQuery = fixBrokenGroupBy(sqlQuery);
  sqlQuery = wrapOrConditionsSafely(sqlQuery);
  sqlQuery = normalizeWhereConditions(sqlQuery);
  sqlQuery = addDistinctIfMissing(sqlQuery);

  // Step 4: Inject team_id filter (single or multiple)
  const lowerQuery = sqlQuery.toLowerCase();
  if (!/where\s+.*team_id\s*=/.test(lowerQuery) && !/where\s+.*team_id\s+in\s*\(/.test(lowerQuery)) {
    if (/select\s+/.test(lowerQuery) && /from\s+/.test(lowerQuery)) {
      sqlQuery = injectTeamIdFilter(sqlQuery, wantsMultiTeamInfo ? authorizedTeamIds : currentTeamId);
      console.log("Modified SQL Query with team_id filter:", sqlQuery);
    } else {
      console.warn("Skipping filter injection: unrecognized SQL.");
    }
  }

  // Step 5: Security check
  // Build regex to ensure query contains allowed team IDs only
  const teamIdRegexStr = authorizedTeamIds
    .map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join("|");

  const teamIdRegex = new RegExp(
    `team_id\\s*(=\\s*['"]?(${teamIdRegexStr})['"]?|IN\\s*\\(\\s*(['"]?(${teamIdRegexStr})['"]?\\s*,?\\s*)+\\))`,
    'i'
  );

  if (!teamIdRegex.test(sqlQuery)) {
  console.warn("Blocked unscoped or unauthorized query attempt:", {
    query: sqlQuery,
    reason: "Team ID regex failed",
    expected: teamIdRegex,
    authorizedTeamIds,
  });
  throw new AppError("Unauthorized SQL query — missing or invalid team scope.", 403);
  }

  // Block dangerous queries
  // Step 5: Security check
  const hasOnlySafeOps = !/\b(drop|alter|insert|update|delete)\b/i.test(sqlQuery);
  if (!hasOnlySafeOps) {
    console.warn("Blocked unsafe query attempt (unsafe ops):", sqlQuery);
  throw new AppError("Unsafe or unsupported SQL operation.", 400)
  }
  // Step 6: Execute SQL
  let dbResult;
  try {
    const queryResult = await db.query(sqlQuery);
    dbResult = queryResult.rows;
    console.log("Raw DB Result:", dbResult);
  } catch (err: any) {
    console.error("SQL execution error:", {
      error: err.message,
      sql: sqlQuery,
      stack: err.stack,
    });
    throw new AppError("Something went wrong while querying the data.", 500);
  }

  // Step 7: AI Answer
  const answer = await this.getAnswerFromQueryResult({ userMessage, result: dbResult });
  const assistantContent = answer?.content ?? "";

  // Step 8: Follow-up suggestions
  const suggestions = await OpenAIService.generateFollowUpSuggestions(userMessage, assistantContent);

  // Step 9: Return final response
  return res.status(200).json(new ServerResponse(true, {
    answer: assistantContent,
    suggestions,
  }));
}
}