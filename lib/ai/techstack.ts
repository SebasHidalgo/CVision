import "server-only";

import { z } from "zod";
import { generateJson } from "@/lib/ai/client";
import { techstackExtractionPrompt } from "@/lib/ai/prompts/techstack-extraction.prompt";
import { techstackSchema } from "@/lib/schemas/interviewSchema";

const techstackResponseSchema = z.object({ techstack: techstackSchema });

// Local model on CPU: a short extraction still costs seconds, not milliseconds.
const TECHSTACK_TIMEOUT_MS = 60_000;

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
