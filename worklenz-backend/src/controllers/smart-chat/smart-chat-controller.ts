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
  const projectAliasMatch =
    /join\s+projects\s+(\w+)/i.exec(sqlQuery) || /from\s+projects\s+(\w+)/i.exec(sqlQuery);
  const alias = projectAliasMatch ? projectAliasMatch[1] : "projects"; // fallback to 'projects'

  const teamFilter = `${alias}.team_id = '${teamId}'`;

  // Inject team_id filter into WHERE clause
  const whereMatch = sqlQuery.match(/where\s+/i);
  if (whereMatch) {
    // Insert after "WHERE " and preserve the rest of the condition
    return sqlQuery.replace(/where\s+/i, `WHERE ${teamFilter} AND `);
  } else {
    // No WHERE clause: inject it at the right place
    return `${sqlQuery} WHERE ${teamFilter}`;
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

  if (intent !== "data_query") {
    const fallback = {
      chit_chat: "I'm here to assist with project data. Try asking about tasks, team members, or deadlines.",
      general_request: "Try asking about tasks, projects, or your team. For example: 'Show all tasks assigned to John'.",
      unknown: "I couldn't understand that clearly. Please ask something about your tasks, projects, or team.",

  } as const;

const validKeys = Object.keys(fallback);
const key = validKeys.includes(intent) ? intent : "unknown";

return res.status(200).json(new ServerResponse(true, {
  answer: fallback[key as keyof typeof fallback],
  suggestions: ["Show overdue tasks", "List my team", "Project status update"]
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
    teamId,
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

  let sqlQuery = queryResponseObj.query.trim();
  console.log("Generated SQL Query:", sqlQuery);

  // Step 4: Inject team_id filter
  const lowerQuery = sqlQuery.toLowerCase();
  if (!/where\s+.*team_id\s*=/.test(lowerQuery)) {
    if (/select\s+/.test(lowerQuery) && /from\s+/.test(lowerQuery)) {
      sqlQuery = injectTeamIdFilter(sqlQuery, teamId);
      console.log("Modified SQL Query with team_id filter:", sqlQuery);
    } else {
      console.warn("Skipping filter injection: unrecognized SQL.");
    }
  }

  // Step 5: Execute SQL
  let dbResult;

const teamIdRegex = new RegExp(`\\b\\w*\\.team_id\\s*=\\s*['"]?${teamId}['"]?`, 'i');

if (!teamIdRegex.test(sqlQuery)) {
  console.warn("Blocked unscoped query attempt:", sqlQuery);
  throw new AppError("Unauthorized SQL query — missing team scope.", 403);
}

// Prevent potentially dangerous queries
if (/drop|alter|insert|update|delete/i.test(sqlQuery)) {
  console.warn("Blocked unsafe query attempt:", sqlQuery);
  throw new AppError("Unsafe or unsupported SQL operation.", 400);
}
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

  // Step 6: AI Answer
  const answer = await this.getAnswerFromQueryResult({ userMessage, result: dbResult });
  const assistantContent = answer?.content ?? "";

  // Step 7: Follow-up suggestions
  const suggestions = await OpenAIService.generateFollowUpSuggestions(userMessage, assistantContent);

  // Step 8: Return final response
  return res.status(200).json(new ServerResponse(true, {
    answer: assistantContent,
    suggestions,
  }));
}

}