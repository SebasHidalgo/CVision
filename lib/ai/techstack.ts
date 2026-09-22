import "server-only";

import { z } from "zod";
import { generateJson } from "@/lib/ai/client";
import { techstackExtractionPrompt } from "@/lib/ai/prompts/techstack-extraction.prompt";
import { techstackSchema } from "@/lib/schemas/interviewSchema";

const techstackResponseSchema = z.object({ techstack: techstackSchema });

// A short list from a short input, well under the analysis' 6-7 s (not
// measured separately). Its caller falls back to no chips on failure, so this
// is the most a slow provider can delay creating the interview.
const TECHSTACK_TIMEOUT_MS = 10_000;

export async function extractTechstackFromDescription(
  description: string,
): Promise<string[]> {
  const { techstack } = await generateJson({
    prompt: techstackExtractionPrompt(description),
    schema: techstackResponseSchema,
    timeoutMs: TECHSTACK_TIMEOUT_MS,
  });

  return techstack;
}
