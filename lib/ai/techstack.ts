import "server-only";

import { z } from "zod";
import { generateJson } from "@/lib/ai/client";
import { techstackExtractionPrompt } from "@/lib/ai/prompts/techstack-extraction.prompt";
import { techstackSchema } from "@/lib/schemas/interviewSchema";

const techstackResponseSchema = z.object({ techstack: techstackSchema });

export async function extractTechstackFromDescription(
  description: string,
): Promise<string[]> {
  const { techstack } = await generateJson({
    provider: "google",
    prompt: techstackExtractionPrompt(description),
    schema: techstackResponseSchema,
    timeoutMs: 30_000,
  });

  return techstack;
}
