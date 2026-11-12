// Stores the seeded fixtures' Spanish translations (free key, ledger); rerun when they change.
// Usage: npx tsx --conditions=react-server --env-file=.env e2e/fixtures/capture-translations.ts
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analysisTranslationInput, feedbackTranslationInput, translateContent, translationSourceHash, type TranslationJob } from "@/lib/ai/translation";
import { resumeFeedbackSchema } from "@/lib/schemas/resumeSchema";
import { beginCalls, endCalls, installEvalFetch } from "../../scripts/eval/spend";
import { seededReport } from "../support/fixtureReport";

const DIR = path.resolve(process.cwd(), "e2e", "fixtures");
const read = (name: string) => JSON.parse(readFileSync(path.join(DIR, name), "utf8"));

async function capture(label: string, job: TranslationJob) {
  const runId = `e2e-fixtures-${randomUUID()}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    beginCalls({ command: "e2e-fixtures", label: "m10d-e2e-fixtures", runId, fixture: label, tier: "free" });
    try {
      const result = await translateContent({ ...job, locale: "es", deadline: Date.now() + 120_000 });
      endCalls();
      console.log(`${label}: ${result.stats.kept}/${result.stats.strings} kept, ${result.fallbacks.length} fell back, ${result.stats.calls} call(s)`);
      return { sourceHash: translationSourceHash(job.sources, "es", job.terms, job.names), payload: result.payload, model: result.model, modelVersion: result.modelVersion };
    } catch (error) {
      endCalls();
      console.warn(`${label}: attempt ${attempt} failed (${error instanceof Error ? error.message : String(error)})`);
      await new Promise((resolve) => setTimeout(resolve, 8_000 * attempt));
    }
  }
  throw new Error(`${label}: no translation after 4 attempts`);
}

async function main() {
  installEvalFetch();
  const analysis = read("analysis.json");
  const feedback = resumeFeedbackSchema.parse(analysis.feedback);
  const forAnalysis = { id: "seed", companyName: analysis.companyName, jobTitle: analysis.jobTitle, feedback };
  const interview = read("interview-es.json");
  const out = {
    about: "Spanish translations of e2e/fixtures/analysis.json and interview-es.json, as the app stores them. Rebuilt by capture-translations.ts.",
    analysis: await capture("analysis", analysisTranslationInput(forAnalysis)),
    feedback: await capture("feedback", feedbackTranslationInput({ id: "seed", report: seededReport(interview), role: interview.role, analysis: forAnalysis })),
  };
  writeFileSync(path.join(DIR, "translations.es.json"), `${JSON.stringify(out, null, 2)}\n`);
}

if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`capture failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
