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
    const [data] = result.rows;

    return res.status(200).send(new ServerResponse(true, data));
  }

  // Handle interpreting a user question, generating SQL, executing it, and responding intelligently
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
      const userMessage = messages[messages.length - 1]?.content ?? "";

      const schema = this.getTableSchema();
      if (!schema) {
        return res.status(400).send(new ServerResponse(false, "Schema not found."));
      }

      // STEP 1- Generate SQL Query
      const queryResponseObj = await SmartChatControllerBase.getSQLQueryFromMessage({
        userMessage,
        userId,
        teamId,
        schema,
      });

      if (!queryResponseObj || typeof queryResponseObj.query !== "string" || queryResponseObj.query.trim() === "") {
        return res.status(400).send(new ServerResponse(false, "No valid SQL query generated."));
      }

      let sqlQuery = queryResponseObj.query.trim();
      console.log("Generated SQL Query:", sqlQuery);

      // STEP 2- Inject team_id filter if missing 
      // Check for team_id filter case-insensitive in WHERE clause
      const lowerQuery = sqlQuery.toLowerCase();
      if (!/where\s+.*team_id\s*=/.test(lowerQuery)) {
        // Insert team_id filter just after FROM clause or after existing WHERE if any
        if (/select\s+/.test(lowerQuery) && /from\s+/.test(lowerQuery)) {
          // Determine if query already has a WHERE clause
          if (/where\s+/i.test(lowerQuery)) {
            // Append team_id condition with AND
            sqlQuery = sqlQuery.replace(/where\s+/i, (match: string) => `${match} team_id = '${teamId}' AND `);
          }
          else {
            // Insert WHERE clause after FROM <table>
            const fromMatch = /from\s+[\w.]+/i.exec(sqlQuery);
            if (fromMatch) {
              const insertPos = fromMatch.index + fromMatch[0].length;
              sqlQuery = sqlQuery.slice(0, insertPos) + ` WHERE team_id = '${teamId}'` + sqlQuery.slice(insertPos);
            } else {
              // fallback- append WHERE at end
              sqlQuery += ` WHERE team_id = '${teamId}'`;
            }
          }
          console.log("Modified SQL Query with team_id filter:", sqlQuery);
        } else {
          console.warn("SQL does not look like a standard SELECT...FROM query. Skipping filter injection.");
        }
      }

      // STEP 3- Execute the SQL Query 
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

      // STEP 4- Generate Final Natural Language Answer 
      const answer = await SmartChatControllerBase.getAnswerFromQueryResult({
        userMessage,
        result: dbResult,
      });

      console.log("AI Answer:", answer);

      // STEP 5- Generate Follow-up Suggestions
      const assistantContent = answer.content ?? "";

      const suggestions = await OpenAIService.generateFollowUpSuggestions(userMessage, assistantContent);

      // STEP 6- Return Full Response
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
