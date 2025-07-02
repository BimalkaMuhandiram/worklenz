import { IWorkLenzRequest } from "../../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../../interfaces/worklenz-response";
import db from "../../config/db";
import { ServerResponse } from "../../models/server-response";
import HandleExceptions from "../../decorators/handle-exceptions";
import SmartChatControllerBase from "./smart-chat-controller-base";
import { ChatLogCreateSchema, ChatInfoRequestSchema } from "./chat.schema";
import { OpenAIService } from "./openai-service";

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
    const userMessage = messages[messages.length - 1]?.content ?? "";

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
        if (/where\s+/i.test(lowerQuery)) {
          sqlQuery = sqlQuery.replace(/where\s+/i, (match: string) => `${match} team_id = '${teamId}' AND `);
        } else {
          const fromMatch = /from\s+[\w.]+/i.exec(sqlQuery);
          if (fromMatch) {
            const insertPos = fromMatch.index + fromMatch[0].length;
            sqlQuery = sqlQuery.slice(0, insertPos) + ` WHERE team_id = '${teamId}'` + sqlQuery.slice(insertPos);
          } else {
            sqlQuery += ` WHERE team_id = '${teamId}'`;
          }
        }
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
      return res.status(500).send(new ServerResponse(false, "Query execution failed."));
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
