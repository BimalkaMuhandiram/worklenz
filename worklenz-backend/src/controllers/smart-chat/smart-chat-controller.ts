import { IWorkLenzRequest } from "../../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../../interfaces/worklenz-response";
import db from "../../config/db";
import { ServerResponse } from "../../models/server-response";
import HandleExceptions from "../../decorators/handle-exceptions";
import SmartChatControllerBase from "./smart-chat-controller-base";
import { PromptBuilder } from "./prompt-builder";
import { ChatLogCreateSchema, ChatInfoRequestSchema } from "./chat.schema";

// Mocked OpenAI client (swap with real one later)
const openAiApiClient = {
  async sendPrompt(prompt: string): Promise<string> {
    return "This is a mock response based on the prompt: " + prompt;
  },
};

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
      if (!teamId) {
        return res.status(400).send(new ServerResponse(false, "Team ID missing."));
      }

      const validation = ChatInfoRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).send(new ServerResponse(false, validation.error.flatten()));
      }

      const { chat: messages } = validation.data;
      const recentMessages = messages.slice(-5);
      const userMessage = recentMessages[recentMessages.length - 1]?.content || "";

      const schema = this.getTableSchema();
      if (!schema) {
        return res.status(400).send(new ServerResponse(false, "Schema not found."));
      }

      const isChartRequest = /(chart|graph|plot|visualize|compare|trend|bar|line|status|tasks by|progress)/i.test(userMessage);

      if (isChartRequest) {
        try {
          const queryData: any = await this.getQueryData(schema, teamId, recentMessages);

          let chartData: any[] = [];

          if (Array.isArray(queryData)) {
            chartData = queryData.map((item: any) => ({
              name: item.team_name ?? "Unknown Team",
              Completed: item.completed ?? 0,
              InProgress: item.in_progress ?? 0,
              Pending: item.pending ?? 0,
            }));
          } else {
            console.warn("Expected array for queryData but got:", typeof queryData);
          }

          const chartResponse = {
            type: "chart",
            chartType: "bar",
            title: "Task Status by Team",
            data: chartData,
          };

          return res.status(200).send(new ServerResponse(true, JSON.stringify(chartResponse)));
        } catch (err) {
          console.error("Chart data error:", err);
          return res.status(500).send(new ServerResponse(false, "Failed to build chart."));
        }
      }

      const prompt = PromptBuilder.build({
        type: "hybrid",
        data: {
          context: {
            messages: recentMessages,
            teamId,
          },
        },
      });

      try {
        const response = await this.getOpenAiResponse(prompt.content);
        return res.status(200).send(new ServerResponse(true, response));
      } catch (err) {
        console.error("OpenAI error:", err);
        return res.status(502).send(new ServerResponse(false, "AI service failed."));
      }
    } catch (err) {
      console.error("getChatInfo error:", err);
      return res.status(500).send(new ServerResponse(false, "Unexpected error."));
    }
  }
}