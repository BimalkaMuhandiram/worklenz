// src/chat/chat.dto.ts
import { z } from "zod";

export const ChatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string().min(1).max(4000),
    })
  ),
  chat: z.string().min(1).max(1000),
  teamId: z.string().uuid(),
  type: z.string().optional(),
  metadata: z
    .object({
      chartMode: z.boolean().optional(),
      chartType: z.string().optional(),
    })
    .optional(),
});