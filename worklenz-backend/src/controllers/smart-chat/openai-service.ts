import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessage,
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
} from "openai/resources";

export class OpenAIService {
  private static client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  });

  public static getClient(): OpenAI {
    return this.client;
  }

  /**
   * Creates a chat completion given an array of messages.
   * Returns the first message from the choices.
   */
  public static async createChatCompletion(
    messages: ChatCompletionMessageParam[]
  ): Promise<ChatCompletionMessage> {
    const response = await this.client.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
      temperature: 0.7,
      max_tokens: 300,
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("No choices returned from OpenAI");
    }

    return response.choices[0].message;
  }

  /**
   * Sends a simple user prompt and returns the assistant's textual response.
   * Handles both string and array content from OpenAI.
   */
  public static async getOpenAiResponse(prompt: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const content = response.choices[0].message?.content;

      if (!content) {
        return "No response from assistant.";
      }

      if (typeof content === "string") {
        return content;
      }

      if (Array.isArray(content)) {
        const parts = content as ChatCompletionContentPart[];

        const textParts = parts
          .filter(
            (part): part is ChatCompletionContentPartText =>
              typeof (part as ChatCompletionContentPartText).text === "string"
          )
          .map((part) => part.text ?? "");

        return textParts.join("");
      }

      return "No response from assistant.";
    } catch (error: any) {
      console.error("OpenAI API error:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        stack: error.stack,
      });

      throw new Error("Failed to get response from OpenAI.");
    }
  }

  /**
   * Generates 2 suggested follow-up questions based on user and assistant messages.
   */
  public static async generateFollowUpSuggestions(
    userMessage: string,
    assistantMessage: string
  ): Promise<string[]> {
    const prompt = `
User asked: "${userMessage}"
Assistant responded: "${assistantMessage}"

Suggest 2 natural follow-up questions the user might ask next:
1.
2.
`;

    try {
      const completion = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a helpful assistant that suggests follow-up questions after each answer." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const content = completion.choices[0].message?.content || "";

      // Extract two questions using RegExp
      const match = content.match(/1\.\s*(.+?)\s*2\.\s*(.+)/s);
      if (match && match.length >= 3) {
        return [match[1].trim(), match[2].trim()];
      }

      return ["Can you elaborate?", "What else should I know about this?"]; // fallback
    } catch (error: any) {
      console.error("Suggestion generation error:", {
        message: error.message,
        data: error.response?.data,
        stack: error.stack,
      });

      return ["Can you elaborate?", "What else should I know about this?"]; // fallback
    }
  }
}
