import { z } from "zod";

// Define allowed roles (expandable in the future)
const RoleEnum = z.enum(["user", "assistant", "system", "tool"]);

// Support string OR OpenAI-style structured content
const MessageContentSchema = z.union([
  z.string().min(1, "Content is required").refine((val) => val.trim().length > 0, {
    message: "Content cannot be empty or whitespace",
  }),
  z
    .array(
      z.object({
        type: z.literal("text"),
        text: z
          .string()
          .min(1, "Text part cannot be empty")
          .refine((val) => val.trim().length > 0, {
            message: "Text part cannot be just whitespace",
          }),
      })
    )
    .min(1, "At least one content part is required"),
]);

// Message schema
const ChatMessageSchema = z.object({
  role: RoleEnum,
  content: MessageContentSchema,
  timestamp: z
    .union([z.string().datetime(), z.date()])
    .optional()
    .transform((val) => (val instanceof Date ? val.toISOString() : val)),
  messageId: z.string().uuid().optional(),
  tokenCount: z.number().int().positive().optional(), // optional token estimate
});

// For chat log creation - allow up to 50 messages now
export const ChatLogCreateSchema = z.object({
  messages: z
    .array(ChatMessageSchema)
    .nonempty("At least one message is required")
    .max(50, "Too many messages. Limit is 50."),
});

// Used for asking info about a chat context
export const ChatInfoRequestSchema = z.object({
  chat: z
    .array(ChatMessageSchema)
    .nonempty("Chat history is required")
    .max(50, "Too many messages. Limit is 50."),
});