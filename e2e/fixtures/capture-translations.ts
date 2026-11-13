// Stores the seeded fixtures' Spanish translations (invented data, free key, ledger).
// Run it when the fixtures or the translation prompt version change: npm run e2e:capture-translations
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { translateContent, type TranslationJob } from "@/lib/ai/translation";
import { TRANSLATION_PROMPT_VERSION } from "@/lib/ai/prompts/translation.prompt";
import { beginCalls, endCalls, installEvalFetch } from "../../scripts/eval/spend";
import { seededSourceHash, seededTranslationJobs, STORED_TRANSLATIONS_FILE } from "../support/translationJobs";

async function capture(label: string, job: TranslationJob) {
  const runId = `e2e-fixtures-${randomUUID()}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    beginCalls({ command: "e2e-fixtures", label: "e2e-fixtures", runId, fixture: label, tier: "free" });
    try {
      const result = await translateContent({ ...job, locale: "es", deadline: Date.now() + 120_000 });
      endCalls();
      console.log(`${label}: ${result.stats.kept}/${result.stats.strings} kept, ${result.fallbacks.length} fell back, ${result.stats.calls} call(s)`);
      return { sourceHash: seededSourceHash(job), payload: result.payload, model: result.model, modelVersion: result.modelVersion };
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
  const jobs = seededTranslationJobs();
  const out = {
    about: "Spanish translations of e2e/fixtures/analysis.json and interview-es.json, as the app stores them. Rebuilt by capture-translations.ts.",
    promptVersion: TRANSLATION_PROMPT_VERSION,
    analysis: await capture("analysis", jobs.analysis),
    feedback: await capture("feedback", jobs.feedback),
  };
  writeFileSync(path.resolve(process.cwd(), STORED_TRANSLATIONS_FILE), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${STORED_TRANSLATIONS_FILE} for translation prompt ${TRANSLATION_PROMPT_VERSION}.`);
}

if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`capture failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
