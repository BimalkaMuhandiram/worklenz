import OpenAI from "openai"; // OpenAI SDK client
import {
  ChatCompletionMessageParam,
  ChatCompletionMessage,
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
  ChatCompletionContentPartRefusal,
} from "openai/resources/chat/completions"; // Chat types
import { encoding_for_model, TiktokenModel } from "tiktoken"; // For counting tokens accurately

export class OpenAIService {
  private static readonly MODEL = "gpt-3.5-turbo"; // Model used
  private static readonly MODEL_TYPED = "gpt-3.5-turbo" as TiktokenModel; // For token encoder
  private static readonly MAX_TOKENS = 4096; // Max tokens allowed per request
  private static readonly RESPONSE_TOKENS = 1000; // Reserved for OpenAI's response

  private static client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  });

  public static getClient(): OpenAI {
    return this.client;
  }

  private static countTokens(
    messages: ChatCompletionMessageParam[],
    model: TiktokenModel
  ): number {
    const encoder = encoding_for_model(model);
    let tokens = 0;

    for (const msg of messages) {
      tokens += 4; // every message overhead
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

    tokens += 2; // priming tokens
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

    // Truncate tokens directly
    const truncatedEncoded = encoded.slice(0, maxTokens);
    // Decode back to string safely
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
    let totalTokens = 2; // priming tokens

    // Handle the last message separately (to allow truncation if needed)
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

    // Add earlier messages until token limit reached
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
  // Main method to create chat completion with trimming and validation
  public static async createChatCompletion(
    messages: ChatCompletionMessageParam[]
  ): Promise<ChatCompletionMessage & { refusal: null }> {
    const maxInputTokens = this.MAX_TOKENS - this.RESPONSE_TOKENS;

    const trimmedMessages = this.trimMessagesToFitTokenLimit(
      messages,
      maxInputTokens,
      this.MODEL_TYPED
    );

    if (!trimmedMessages || trimmedMessages.length === 0) {
      throw new Error("No valid messages after trimming for token limit.");
    }

    const response = await this.client.chat.completions.create({
      model: this.MODEL,
      messages: trimmedMessages,
      temperature: 0.7,
      max_tokens: this.RESPONSE_TOKENS,
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("No choices returned from OpenAI");
    }

    // Add refusal:null to satisfy your type requirements
    return {
      ...response.choices[0].message,
      refusal: null,
    };
  }

  public static async getOpenAiResponse(prompt: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: this.RESPONSE_TOKENS,
      });

      const content = response.choices[0]?.message?.content;

      if (typeof content === "string") {
        return content;
      }

      if (Array.isArray(content)) {
  const textParts = (content as (ChatCompletionContentPart | ChatCompletionContentPartRefusal)[])
    .map((part) => {
      if (isTextPart(part)) {
        return part.text;
      }
      return null;
    })
    .filter((text): text is string => text !== null);

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
        model: this.MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that suggests follow-up questions after each answer.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const content = completion.choices[0].message?.content ?? "";

      const match: RegExpMatchArray | null = content.match(/1\.\s*(.+?)\s*2\.\s*(.+)/s);
      if (match && match.length >= 3) {
        return [match[1].trim(), match[2].trim()];
      }

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

  // Upgrade embedding model & improve getEmbedding 
  public static async getEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-large", 
      input: text,
    });

    return response.data[0].embedding;
  }

  // Add batch embedding method for efficiency 
  public static async getBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.client.embeddings.create({
      model: "text-embedding-3-large",
      input: texts,
    });

    return response.data.map((item) => item.embedding);
  }

  // Add vector similarity helper function 
  // Cosine similarity between two vectors
  public static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error("Vectors must be the same length for cosine similarity.");
    }
    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      magA += vecA[i] * vecA[i];
      magB += vecB[i] * vecB[i];
    }
    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
  }
}

// Type guard
function isTextPart(
  part: ChatCompletionContentPart | ChatCompletionContentPartRefusal
): part is ChatCompletionContentPartText {
  return "text" in part && typeof part.text === "string";
}
