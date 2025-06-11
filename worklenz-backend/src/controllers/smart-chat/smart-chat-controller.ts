import { IWorkLenzRequest } from "../../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../../interfaces/worklenz-response";
import db from "../../config/db";
import { ServerResponse } from "../../models/server-response";
import HandleExceptions from "../../decorators/handle-exceptions";
import SmartChatControllerBase from "./smart-chat-controller-base";
import { PromptBuilder } from "./prompt-builder";
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

    const q = `
      INSERT INTO chat_log (team_id, user_id, messages, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING *;
    `;
    const result = await db.query(q, [teamId, userId, JSON.stringify(messages)]);
    const [data] = result.rows;

    return res.status(200).send(new ServerResponse(true, data));
  }

  @HandleExceptions()
  public static async getChatInfo(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    try {
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
      const userMessage = messages[messages.length - 1]?.content || "";

      const schema = this.getTableSchema();
      if (!schema) {
        return res.status(400).send(new ServerResponse(false, "Schema not found."));
      }

      // === STEP 1: Generate SQL Query ===
      const queryResponseObj = await SmartChatControllerBase.getSQLQueryFromMessage({
        userMessage,
        userId,
        teamId,
        schema,
      });

      if (!queryResponseObj || typeof queryResponseObj.query !== "string" || queryResponseObj.query.trim() === "") {
        return res.status(400).send(new ServerResponse(false, "No valid SQL query generated."));
      }

      const sqlQuery = queryResponseObj.query.trim();
      console.log("Generated SQL Query:", sqlQuery);

      // === STEP 2: Execute the SQL Query ===
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

      // === STEP 3: Generate Final Natural Language Answer ===
      const answer = await SmartChatControllerBase.getAnswerFromQueryResult({
        userMessage,
        result: dbResult,
      });

      console.log("AI Answer:", answer);

      // === STEP 4: Generate Follow-up Suggestions ===
      const assistantContent = answer.content ?? ""; // fallback empty string if null

      const suggestions = await OpenAIService.generateFollowUpSuggestions(
        userMessage,
        assistantContent
      );

      // === STEP 5: Return Full Response ===
      return res.status(200).send(
        new ServerResponse(true, {
          answer: answer.content,
          suggestions,
      })
      );

    } catch (err) {
      console.error("getChatInfo error:", err);
      return res.status(500).send(new ServerResponse(false, "Unexpected error."));
    }
  }
}
