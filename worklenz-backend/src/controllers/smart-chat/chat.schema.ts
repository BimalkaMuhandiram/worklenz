// Data validation schemas
import { z } from "zod"; // Provides tools to define and validate schemas

// Define a reusable message schema
const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z
    .string()
    .min(1, "Content is required")
    .max(2000, "Content too long")
    .refine((val) => val.trim().length > 0, {
      message: "Content cannot be empty or whitespace",
    }),
  timestamp: z.string().datetime().optional(), // ISO format recommended (e.g., new Date().toISOString())
  messageId: z.string().uuid().optional(), // UUID or any unique ID
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
