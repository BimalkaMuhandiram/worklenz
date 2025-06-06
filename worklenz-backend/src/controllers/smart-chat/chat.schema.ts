import { z } from "zod";

// Define a reusable message schema
const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1, "Content is required").max(2000, "Content too long"),
  timestamp: z.string().optional(), // ISO format recommended (e.g., new Date().toISOString())
  messageId: z.string().optional(), // UUID or any unique ID
});

// Chat log creation requires at least one message, max 20
export const ChatLogCreateSchema = z.object({
  messages: z
    .array(ChatMessageSchema)
    .nonempty("At least one message is required")
    .max(20, "Too many messages. Limit is 20."),
});

// Chat info request (same structure as chat log)
export const ChatInfoRequestSchema = z.object({
  chat: z
    .array(ChatMessageSchema)
    .nonempty("Chat history is required")
    .max(20, "Too many messages. Limit is 20."),
});
