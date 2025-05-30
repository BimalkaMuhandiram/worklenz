import OpenAI from "openai";

export class OpenAIService {
  private static client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  });

  public static getClient(): OpenAI {
    return this.client;
  }

  public static async createChatCompletion(
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
  ): Promise<OpenAI.Chat.ChatCompletionMessage> {
    const response = await this.client.chat.completions.create({
      model: "gpt-3.5-turbo-0125",
      messages,
      temperature: 0.7,
      max_tokens: 300,
    });
    return response.choices[0].message;
  }

  public static async getOpenAiResponse(prompt: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo-0125",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 300,
      });
      return response.choices[0].message?.content ?? "No response from assistant.";
    } catch (error: any) {
  console.error("OpenAI API error:", {
    message: error.message,
    status: error.response?.status,
    data: error.response?.data,
  });
  throw new Error("Failed to get response from OpenAI.");
}
  }
}
