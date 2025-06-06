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
      const queryPrompt = PromptBuilder.buildSQLQueryPrompt({
        userMessage,
        schema,
        userId,
        teamId
      });

      const contentString = typeof queryPrompt.content === "string" ? queryPrompt.content : "";
      console.log("Prompt to OpenAI (SQL generation):", contentString);

      const queryResponse = await OpenAIService.getOpenAiResponse(contentString);
      console.log("OpenAI raw response:", queryResponse);

      let parsed: any;
      try {
        parsed = JSON.parse(queryResponse);
      } catch (err) {
        console.error("Failed to parse OpenAI response:", err);
        return res.status(400).send(new ServerResponse(false, "Failed to parse query response."));
      }

      const sqlQuery = parsed?.query;
      if (!sqlQuery || typeof sqlQuery !== "string" || sqlQuery.trim() === "") {
        return res.status(400).send(new ServerResponse(false, "No valid SQL query generated."));
      }

      // === STEP 2: Execute the SQL Query ===
      console.log("Generated SQL Query:", sqlQuery);

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
      const finalPrompt = PromptBuilder.buildAnswerFromResultsPrompt({
        userMessage,
        queryResult: dbResult,
      });

      console.log("Prompt to OpenAI (Answer Generation):", finalPrompt.content);

      const finalResponse = await OpenAIService.getOpenAiResponse(
        typeof finalPrompt.content === "string" ? finalPrompt.content : ""
      );

      console.log("OpenAI Final Response:", finalResponse);

      return res.status(200).send(new ServerResponse(true, finalResponse));
    } catch (err) {
      console.error("getChatInfo error:", err);
      return res.status(500).send(new ServerResponse(false, "Unexpected error."));
    }
  }
}
