import { readFileSync } from "node:fs";
import path from "node:path";
import { analysisTranslationInput, feedbackTranslationInput, translationSourceHash, type TranslationJob } from "@/lib/ai/translation";
import { TRANSLATION_PROMPT_VERSION } from "@/lib/ai/prompts/translation.prompt";
import { resumeFeedbackSchema } from "@/lib/schemas/resumeSchema";
import { seededReport } from "./fixtureReport";

// What the suite's stored Spanish translations translate: the seeded analysis and interview feedback.

const DIR = path.resolve(process.cwd(), "e2e", "fixtures");
const read = (name: string) => JSON.parse(readFileSync(path.join(DIR, name), "utf8"));

export const STORED_TRANSLATIONS_FILE = "e2e/fixtures/translations.es.json";
export const RECAPTURE_COMMAND = "npm run e2e:capture-translations";

export type SeededTranslationKey = "analysis" | "feedback";

/** The two jobs exactly as the app would build them for the seeded rows. */
export function seededTranslationJobs(): Record<SeededTranslationKey, TranslationJob> {
  const analysis = read("analysis.json");
  const feedback = resumeFeedbackSchema.parse(analysis.feedback);
  const forAnalysis = { id: "seed", companyName: analysis.companyName, jobTitle: analysis.jobTitle, feedback };
  const interview = read("interview-es.json");
  return {
    analysis: analysisTranslationInput(forAnalysis),
    feedback: feedbackTranslationInput({ id: "seed", report: seededReport(interview), role: interview.role, analysis: forAnalysis }),
  };
}

/** The hash the app looks a stored translation up by; it changes with the prompt version and the source. */
export const seededSourceHash = (job: TranslationJob) => translationSourceHash(job.sources, "es", job.terms, job.names);

/** Why the stored file no longer serves the suite, with the command that fixes it; null when it does. */
export function staleTranslations(stored: { promptVersion?: string } & Partial<Record<SeededTranslationKey, { sourceHash?: string }>>): string | null {
  const jobs = seededTranslationJobs();
  const stale = (Object.keys(jobs) as SeededTranslationKey[]).filter((key) => stored[key]?.sourceHash !== seededSourceHash(jobs[key]));
  if (stale.length === 0) return null;
  const why =
    stored.promptVersion && stored.promptVersion !== TRANSLATION_PROMPT_VERSION
      ? `it was captured for translation prompt "${stored.promptVersion}" and the prompt is now "${TRANSLATION_PROMPT_VERSION}"`
      : "the seeded fixtures or their terms changed since it was captured";
  return `${STORED_TRANSLATIONS_FILE} is stale (${stale.join(", ")}): ${why}. Re-capture it: ${RECAPTURE_COMMAND}`;
}
