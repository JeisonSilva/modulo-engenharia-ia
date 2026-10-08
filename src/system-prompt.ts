import { z } from "zod";

export const systemPromptSchema = z.object({
  papel: z.string(),
  objetivo: z.string(),
  contexto: z.string(),
});

export type SystemPrompt = z.infer<typeof systemPromptSchema>;
