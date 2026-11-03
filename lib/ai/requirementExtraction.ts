import "server-only";

import { z } from "zod";
import { loosen, normalizeWhitespace } from "@/lib/ai/analysisChecks";
import { generateJson } from "@/lib/ai/client";
import { LINE_ROLES, numberLines, requirementExtractionPrompt, type LineRole } from "@/lib/ai/prompts/requirement-extraction.prompt";
import { REQUIREMENT_KINDS, type RequirementKind } from "@/lib/schemas/resumeSchema";

/**
 * The two-call experiment's first call (M8-A): the posting's requirements
 * alone, before any CV is involved. Experimental; scripts/eval is the only
 * caller and production does not use it until M8-B.
 */

const lowerEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (typeof value === "string" ? value.trim().toLowerCase() : value), z.enum(values));

export const extractionSchema = z.object({
  lines: z.array(
    z.object({
      line: z.number().int(),
      role: lowerEnum(LINE_ROLES),
      requirementIds: z.array(z.string()),
    }),
  ),
  requirements: z.array(
    z.object({
      id: z.string(),
      requirement: z.string(),
      kind: lowerEnum(REQUIREMENT_KINDS),
      lines: z.array(z.number().int()),
      quote: z.string(),
    }),
  ),
});

export type ExtractionAnswer = z.infer<typeof extractionSchema>;

export type ExtractedRequirement = {
  requirement: string;
  kind: RequirementKind;
  lines: number[];
  quote: string;
  /** The quote matched the posting only after case and punctuation were ignored. */
  quoteNormalized: boolean;
};

export type ExtractionResult = {
  requirements: ExtractedRequirement[];
  dropped: { requirement: string; reason: "empty-quote" | "quote-not-in-posting" }[];
  /** Numbered lines the answer never mentioned. */
  unaccountedLines: number[];
  /** Line numbers the answer mentioned that do not exist, or mentioned twice. */
  bogusLines: number[];
  roles: Record<LineRole, number>;
  lineCount: number;
};

export const EXTRACTION_TIMEOUT_MS = 30_000;

export async function extractRequirements({
  jobTitle,
  jobDescription,
  timeoutMs = EXTRACTION_TIMEOUT_MS,
}: {
  jobTitle: string;
  jobDescription: string;
  timeoutMs?: number;
}): Promise<ExtractionResult> {
  const lines = numberLines(jobDescription);
  const answer = await generateJson({
    prompt: requirementExtractionPrompt({ jobTitle, lines }),
    schema: extractionSchema,
    timeoutMs,
  });
  return checkExtraction(jobDescription, lines.length, answer);
}

/** The code checks: quotes verbatim in the posting, every line accounted for. Pure. */
export function checkExtraction(posting: string, lineCount: number, answer: ExtractionAnswer): ExtractionResult {
  const strict = normalizeWhitespace(posting);
  const loose = loosen(posting);

  const requirements: ExtractedRequirement[] = [];
  const dropped: ExtractionResult["dropped"] = [];
  for (const item of answer.requirements) {
    const quote = normalizeWhitespace(item.quote);
    if (!quote) {
      dropped.push({ requirement: item.requirement, reason: "empty-quote" });
      continue;
    }
    const exact = strict.includes(quote);
    if (!exact && !loose.includes(loosen(quote))) {
      dropped.push({ requirement: item.requirement, reason: "quote-not-in-posting" });
      continue;
    }
    requirements.push({ requirement: item.requirement.trim(), kind: item.kind, lines: item.lines, quote, quoteNormalized: !exact });
  }

  const seen = new Set<number>();
  const bogusLines: number[] = [];
  const roles = Object.fromEntries(LINE_ROLES.map((role) => [role, 0])) as Record<LineRole, number>;
  for (const entry of answer.lines) {
    if (entry.line < 1 || entry.line > lineCount || seen.has(entry.line)) {
      bogusLines.push(entry.line);
      continue;
    }
    seen.add(entry.line);
    roles[entry.role] += 1;
  }
  const unaccountedLines = Array.from({ length: lineCount }, (_, i) => i + 1).filter((line) => !seen.has(line));

  return { requirements, dropped, unaccountedLines, bogusLines, roles, lineCount };
}
