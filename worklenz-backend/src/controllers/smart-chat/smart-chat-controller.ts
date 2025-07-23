import { IWorkLenzRequest } from "../../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../../interfaces/worklenz-response";
import db from "../../config/db";
import { ServerResponse } from "../../models/server-response";
import HandleExceptions from "../../decorators/handle-exceptions";
import SmartChatControllerBase from "./smart-chat-controller-base";
import { ChatLogCreateSchema, ChatInfoRequestSchema } from "./chat.schema";
import { OpenAIService } from "./openai-service";
import { AppError } from "../../utils/AppError";

function injectTeamIdFilter(sqlQuery: string, teamId: string): string {
  // Check if query joins the "projects" table with alias (e.g., "projects p")
  const projectAliasMatch = /join\s+projects\s+(\w+)/i.exec(sqlQuery) || /from\s+projects\s+(\w+)/i.exec(sqlQuery);
  const alias = projectAliasMatch ? projectAliasMatch[1] : null;

  if (!alias) {
    console.warn("No 'projects' table alias found. Skipping team_id injection.");
    return sqlQuery;
  }

  // Inject team_id condition safely
  if (/where\s+/i.test(sqlQuery)) {
    return sqlQuery.replace(/where\s+/i, (match) => `${match} ${alias}.team_id = '${teamId}' AND `);
  } else {
    // No WHERE clause: inject new one after FROM clause
    const fromEndIndex = sqlQuery.toLowerCase().indexOf("from") + 4;
    const afterFromMatch = /from\s+[\w.]+\s+\w+/i.exec(sqlQuery);
    if (afterFromMatch) {
      const insertPos = afterFromMatch.index + afterFromMatch[0].length;
      return (
        sqlQuery.slice(0, insertPos) +
        ` WHERE ${alias}.team_id = '${teamId}'` +
        sqlQuery.slice(insertPos)
      );
    } else {
      return sqlQuery + ` WHERE ${alias}.team_id = '${teamId}'`;
    }
  }
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
  const teamId = this.getCurrentTeamId(req);
  const userId = req.user?.id;
  if (!teamId || !userId) {
    throw new AppError("Team or User ID missing.", 400);
  }

  const validation = ChatInfoRequestSchema.safeParse(req.body);
  if (!validation.success) {
    throw new AppError("Invalid input data.", 400);
  }

  const { chat: messages } = validation.data;
  const lastMessage = messages[messages.length - 1];
  const userMessage =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : lastMessage.content.map((c) => c.text).join(" ");

  const schema = this.getTableSchema();
  if (!schema) {
    throw new AppError("No schema available.", 400);
  }

  // STEP 1: Generate SQL
  const queryResponseObj = await this.getSQLQueryFromMessage({
    userMessage,
    userId,
    teamId,
    schema,
  });

  if (
    !queryResponseObj ||
    typeof queryResponseObj.query !== "string" ||
    queryResponseObj.query.trim() === ""
  ) {
    throw new AppError("Sorry, I couldn’t understand your request.", 400);
  }

  let sqlQuery = queryResponseObj.query.trim();
  console.log("Generated SQL Query:", sqlQuery);

  // STEP 2: Enforce team_id filter
  const lowerQuery = sqlQuery.toLowerCase();
  if (!/where\s+.*team_id\s*=/.test(lowerQuery)) {
    if (/select\s+/.test(lowerQuery) && /from\s+/.test(lowerQuery)) {
      sqlQuery = injectTeamIdFilter(sqlQuery, teamId);
      console.log("Modified SQL Query with team_id filter:", sqlQuery);
    } else {
      console.warn("Skipping filter injection: unrecognized SQL.");
    }
  }

  // STEP 3: Execute SQL
  let dbResult;
  try {
    const queryResult = await db.query(sqlQuery);
    dbResult = queryResult.rows;
  } catch (err: any) {
    console.error("SQL execution error:", {
      error: err.message,
      sql: sqlQuery,
      stack: err.stack,
    });
    throw new AppError("Something went wrong while querying the data.", 500);
  }

  // STEP 4: AI Answer
  const answer = await this.getAnswerFromQueryResult({ userMessage, result: dbResult });
  const assistantContent = answer?.content ?? "";

  // STEP 5: Follow-up suggestions
  const suggestions = await OpenAIService.generateFollowUpSuggestions(userMessage, assistantContent);

  // STEP 6: Success response
  return res.status(200).json(new ServerResponse(true, {
    answer: assistantContent,
    suggestions,
  }));
}
}