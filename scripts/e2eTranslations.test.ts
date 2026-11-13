import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRANSLATION_PROMPT_VERSION } from "@/lib/ai/prompts/translation.prompt";
import { RECAPTURE_COMMAND, seededSourceHash, seededTranslationJobs, staleTranslations, STORED_TRANSLATIONS_FILE } from "../e2e/support/translationJobs";

const stored = JSON.parse(readFileSync(path.resolve(process.cwd(), STORED_TRANSLATIONS_FILE), "utf8"));

describe("the browser suite's stored Spanish translations", () => {
  it("still match the seeded fixtures and the translation prompt version", () => {
    // A stale file makes the seeded pages translate again, and the suite fails on the model call instead.
    const stale = staleTranslations(stored);
    if (stale) throw new Error(stale);
    expect(stored.promptVersion).toBe(TRANSLATION_PROMPT_VERSION);
  });

  it("say what changed and how to re-capture when they do not", () => {
    const jobs = seededTranslationJobs();
    const current = { analysis: { sourceHash: seededSourceHash(jobs.analysis) }, feedback: { sourceHash: seededSourceHash(jobs.feedback) } };

    expect(staleTranslations({ promptVersion: TRANSLATION_PROMPT_VERSION, ...current })).toBeNull();
    // Captured for an earlier prompt: every hash differs, and the message names both versions.
    expect(staleTranslations({ promptVersion: "t0", analysis: { sourceHash: "old" }, feedback: { sourceHash: "old" } })).toBe(
      `${STORED_TRANSLATIONS_FILE} is stale (analysis, feedback): it was captured for translation prompt "t0" and the prompt is now "${TRANSLATION_PROMPT_VERSION}". Re-capture it: ${RECAPTURE_COMMAND}`,
    );
    // The same prompt, a fixture edited since.
    expect(staleTranslations({ promptVersion: TRANSLATION_PROMPT_VERSION, ...current, feedback: { sourceHash: "old" } })).toBe(
      `${STORED_TRANSLATIONS_FILE} is stale (feedback): the seeded fixtures or their terms changed since it was captured. Re-capture it: ${RECAPTURE_COMMAND}`,
    );
  });
});
