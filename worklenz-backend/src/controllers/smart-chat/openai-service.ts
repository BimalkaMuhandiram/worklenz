import OpenAI from "openai";
import {
  ChatCompletionMessageParam,
  ChatCompletionMessage,
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
  ChatCompletionContentPartRefusal,
} from "openai/resources/chat/completions";
import { encoding_for_model, TiktokenModel } from "tiktoken";

export class OpenAIService {
  private static readonly MODEL = "gpt-3.5-turbo";
  private static readonly MODEL_TYPED = "gpt-3.5-turbo" as TiktokenModel;
  private static readonly MAX_TOKENS = 4096;
  private static readonly DEFAULT_RESPONSE_TOKENS = 1000;

  private static client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  });

  public static getClient(): OpenAI {
    return this.client;
  }

  private static async withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 300): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise((res) => setTimeout(res, delay * (2 ** i)));
      }
    }
    throw new Error("Retries failed.");
  }

  private static countTokens(messages: ChatCompletionMessageParam[], model: TiktokenModel): number {
    const encoder = encoding_for_model(model);
    let tokens = 0;
    for (const msg of messages) {
      tokens += 4;
      if (typeof msg.content === "string") {
        tokens += encoder.encode(msg.content).length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (isTextPart(part)) {
            tokens += encoder.encode(part.text).length;
          }
        }
      }
    }
    tokens += 2;
    encoder.free();
    return tokens;
  }

  private static truncateTextToFitTokens(
    text: string,
    maxTokens: number,
    encoder: ReturnType<typeof encoding_for_model>
  ): string {
    const encoded = encoder.encode(text);
    if (encoded.length <= maxTokens) return text;

    const truncatedEncoded = encoded.slice(0, maxTokens);
    const decoder = new TextDecoder();
    return decoder.decode(new Uint8Array(truncatedEncoded));
  }

  private static trimMessagesToFitTokenLimit(
    messages: ChatCompletionMessageParam[],
    maxTokens: number,
    model: TiktokenModel
  ): ChatCompletionMessageParam[] {
    const encoder = encoding_for_model(model);
    const trimmedMessages: ChatCompletionMessageParam[] = [];
    let totalTokens = 2;

    if (messages.length === 0) {
      encoder.free();
      return [];
    }

    const lastMessage = { ...messages[messages.length - 1] };
    let lastMsgTokens = 4;

    if (typeof lastMessage.content === "string") {
      lastMsgTokens += encoder.encode(lastMessage.content).length;
      if (lastMsgTokens > maxTokens) {
        lastMessage.content = this.truncateTextToFitTokens(
          lastMessage.content,
          maxTokens - 4,
          encoder
        );
        lastMsgTokens = 4 + encoder.encode(lastMessage.content).length;
      }
    } else if (Array.isArray(lastMessage.content)) {
      for (const part of lastMessage.content) {
        if (isTextPart(part)) {
          lastMsgTokens += encoder.encode(part.text).length;
        }
      }
    }

    trimmedMessages.push(lastMessage);
    totalTokens += lastMsgTokens;

    for (let i = messages.length - 2; i >= 0; i--) {
      const msg = messages[i];
      let tokenCount = 4;
      if (typeof msg.content === "string") {
        tokenCount += encoder.encode(msg.content).length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (isTextPart(part)) {
            tokenCount += encoder.encode(part.text).length;
          }
        }
      }
      if (totalTokens + tokenCount > maxTokens) break;

      trimmedMessages.push(msg);
      totalTokens += tokenCount;
    }

    encoder.free();
    return trimmedMessages.reverse();
  }

  public static async createChatCompletion(
    messages: ChatCompletionMessageParam[],
    temperature = 0.7,
    maxResponseTokens = this.DEFAULT_RESPONSE_TOKENS
  ): Promise<ChatCompletionMessage & { refusal: null }> {
    const maxInputTokens = this.MAX_TOKENS - maxResponseTokens;

    const trimmedMessages = this.trimMessagesToFitTokenLimit(
      messages,
      maxInputTokens,
      this.MODEL_TYPED
    );

    if (!trimmedMessages.length) {
      throw new Error("No valid messages after trimming for token limit.");
    }

    const response = await this.withRetry(() =>
      this.client.chat.completions.create({
        model: this.MODEL,
        messages: trimmedMessages,
        temperature,
        max_tokens: maxResponseTokens,
      })
    );

    if (!response.choices?.length) {
      throw new Error("No choices returned from OpenAI");
    }

    return {
      ...response.choices[0].message,
      refusal: null,
    };
  }

  public static async getOpenAiResponse(prompt: string): Promise<string> {
    try {
      const response = await this.withRetry(() =>
        this.client.chat.completions.create({
          model: this.MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: this.DEFAULT_RESPONSE_TOKENS,
        })
      );

      const content = response.choices[0]?.message?.content;

      if (typeof content === "string") {
        return content;
      }

      if (Array.isArray(content)) {
        const textParts = (content as Array<ChatCompletionContentPart | ChatCompletionContentPartRefusal>)
          .filter((part): part is ChatCompletionContentPartText => isTextPart(part))
          .map((part) => part.text);

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

  // Generate follow-up question suggestions to enhance UX
  public static async generateFollowUpSuggestions(
    userMessage: string,
    assistantMessage: string
  ): Promise<string[]> {
    const prompt = `
User asked: "${userMessage}"
Assistant responded: "${assistantMessage}"

Suggest 2 natural and helpful follow-up questions the user might ask next:
1.
2.
`;

    try {
      const completion = await this.client.chat.completions.create({
        model: this.MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that suggests natural follow-up questions after each answer.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const content = completion.choices[0].message?.content ?? "";

      const match = content.match(/1\.\s*(.+?)\s*2\.\s*(.+)/s);
      if (match && match.length >= 3) {
        return [match[1].trim(), match[2].trim()];
      }

      // Fallback suggestions
      return ["Can you elaborate?", "What else should I know about this?"];
    } catch (error: any) {
      console.error("Suggestion generation error:", {
        message: error.message,
        data: error.response?.data,
        stack: error.stack,
      });

      return ["Can you elaborate?", "What else should I know about this?"];
    }
  }

  public static async classifyUserIntent(userMessage: string): Promise<string> {
    const prompt = `
Classify this message into one of the following: data_query, chit_chat, help, other.
Respond ONLY with one of these keywords.

Message: "${userMessage}"
`;

    try {
      const completion = await this.withRetry(() =>
        this.client.chat.completions.create({
          model: this.MODEL,
          messages: [
            { role: "system", content: "You are an intent classifier." },
            { role: "user", content: prompt },
          ],
          temperature: 0,
          max_tokens: 10,
        })
      );

      const content = completion.choices[0].message?.content?.trim().toLowerCase();

      if (["data_query", "chit_chat", "help", "other"].includes(content || "")) {
        return content!;
      }

      return "other";
    } catch (err) {
      console.error("Error classifying user intent:", err);
      return "other";
    }
  }

  public static async getEmbedding(text: string): Promise<number[]> {
    const response = await this.withRetry(() =>
      this.client.embeddings.create({
        model: "text-embedding-3-large",
        input: text,
      })
    );

    return response.data[0].embedding;
  }

  public static async getBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.withRetry(() =>
      this.client.embeddings.create({
        model: "text-embedding-3-large",
        input: texts,
      })
    );

    return response.data.map((item) => item.embedding);
  }

  public static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error("Vectors must be the same length for cosine similarity.");
    }
    let dot = 0,
      magA = 0,
      magB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      magA += vecA[i] ** 2;
      magB += vecB[i] ** 2;
    }

    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
  }
}

function isTextPart(
  part: ChatCompletionContentPart | ChatCompletionContentPartRefusal
): part is ChatCompletionContentPartText {
  return "text" in part && typeof part.text === "string";
}