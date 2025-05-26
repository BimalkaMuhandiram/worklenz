import { z } from "zod";

export const ChatLogCreateSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1)
    })
  ).nonempty("At least one message is required")
});

export const ChatInfoRequestSchema = z.object({
  chat: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1)
    })
  ).nonempty("Chat history is required")
});