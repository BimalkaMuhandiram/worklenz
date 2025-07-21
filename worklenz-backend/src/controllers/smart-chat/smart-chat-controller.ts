import { IWorkLenzRequest } from "../../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../../interfaces/worklenz-response";
import db from "../../config/db";
import { ServerResponse } from "../../models/server-response";
import HandleExceptions from "../../decorators/handle-exceptions";
import SmartChatControllerBase from "./smart-chat-controller-base";
import { ChatLogCreateSchema, ChatInfoRequestSchema } from "./chat.schema";
import { OpenAIService } from "./openai-service";

function injectTeamIdFilter(sqlQuery: string, teamId: string): string {
  // Try to find the main table alias from FROM clause, e.g. "FROM tasks t"
  const fromMatch = /from\s+[\w.]+\s+(\w+)/i.exec(sqlQuery);
  const alias = fromMatch ? fromMatch[1] : null;

  if (!alias) {
    // fallback: just use team_id without alias (may cause error if ambiguous)
    console.warn("Could not detect table alias in SQL, injecting unqualified team_id");
    return sqlQuery.replace(/where\s+/i, (match) => `${match} team_id = '${teamId}' AND `);
  }

  // Inject team_id filter qualified with alias, e.g., t.team_id = '...'
  if (/where\s+/i.test(sqlQuery)) {
    return sqlQuery.replace(/where\s+/i, (match) => `${match} ${alias}.team_id = '${teamId}' AND `);
  } else {
    // No WHERE clause found; add it after FROM clause
    const fromEndIndex = sqlQuery.toLowerCase().indexOf("from") + 4;
    // Find position after FROM table alias
    const afterFromMatch = /from\s+[\w.]+\s+\w+/i.exec(sqlQuery);
    if (afterFromMatch) {
      const insertPos = afterFromMatch.index + afterFromMatch[0].length;
      return (
        sqlQuery.slice(0, insertPos) +
        ` WHERE ${alias}.team_id = '${teamId}'` +
        sqlQuery.slice(insertPos)
      );
    } else {
      // fallback: append at the end (not recommended)
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
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async getChatInfo(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const teamId = this.getCurrentTeamId(req);
    const userId = req.user?.id;

    if (!teamId || !userId) {
      return res.status(400).send(new ServerResponse(false, "Team or User ID missing."));
    }

    const validation = ChatInfoRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).send(new ServerResponse(false, validation.error.flatten()));
    }

    const { chat: messages } = validation.data;
    const lastMessage = messages[messages.length - 1];
    const userMessage =
      typeof lastMessage.content === "string"
        ? lastMessage.content
        : lastMessage.content.map((c) => c.text).join(" ");

    const schema = this.getTableSchema();
    if (!schema) {
      return res.status(400).send(new ServerResponse(false, "Schema not found."));
    }

    // STEP 1: Generate SQL Query
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
      return res.status(400).send(new ServerResponse(false, "No valid SQL query generated."));
    }

    let sqlQuery = queryResponseObj.query.trim();
    console.log("Generated SQL Query:", sqlQuery);

    // STEP 2: Enforce team_id filter if missing
    const lowerQuery = sqlQuery.toLowerCase();
    if (!/where\s+.*team_id\s*=/.test(lowerQuery)) {
      if (/select\s+/.test(lowerQuery) && /from\s+/.test(lowerQuery)) {
        sqlQuery = injectTeamIdFilter(sqlQuery, teamId);
        console.log("Modified SQL Query with team_id filter:", sqlQuery);
      } else {
        console.warn("SQL does not look like a standard SELECT...FROM query. Skipping filter injection.");
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
      return res.status(200).send(
        new ServerResponse(true, {
          answer: "Sorry, I couldn’t find the data you’re looking for.",
          suggestions: [], 
        })
      );

    }

    // STEP 4: Generate natural language response
    const answer = await this.getAnswerFromQueryResult({ userMessage, result: dbResult });
    const assistantContent = answer?.content ?? "";
    console.log("AI Answer:", assistantContent);

    // STEP 5: Generate follow-up suggestions
    const suggestions = await OpenAIService.generateFollowUpSuggestions(userMessage, assistantContent);

    // STEP 6: Send response
    return res.status(200).send(
      new ServerResponse(true, {
        answer: assistantContent,
        suggestions,
      })
    );
  }
}