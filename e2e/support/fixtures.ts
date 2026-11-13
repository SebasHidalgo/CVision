import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test as base } from "@playwright/test";

/**
 * The suite's `test`: Playwright's, plus a watcher on the browser console
 * for Content-Security-Policy messages. Under CSP_MODE=report-only the
 * browser reports what the policy would have blocked without blocking it;
 * enforced, a violation breaks something the specs then catch. Either way
 * the messages are printed, annotated on the test and appended to
 * e2e/.artifacts/csp.log, so a run doubles as the policy's proof.
 */

const CSP_LOG = path.resolve(process.cwd(), "e2e", ".artifacts", "csp.log");
const CSP_MESSAGE = /Content Security Policy|Refused to (load|frame|connect|execute|apply|create a worker)/;

const LEDGER = () => process.env.EVAL_SPEND_LEDGER?.trim() || path.resolve(process.cwd(), "scripts", "eval", "runs", "spend.jsonl");
/** The suite's model calls so far: the e2e rows in the ledger. */
function suiteModelCalls(): number {
  const file = LEDGER();
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.includes('"command":"e2e"')).length;
}

/** Only these specs may call the model; everything else runs on seeded analyses and translations. The voice spec's call is the feedback of its own short interview. */
const MODEL_SPECS = /(?:smoke|voice)\.spec\.ts$/;

export const test = base.extend<{ cspWatch: void; modelCallGuard: void }>({
  // A test outside the smoke specs that calls Gemini fails.
  modelCallGuard: [
    async ({}, use, testInfo) => {
      const before = suiteModelCalls();
      await use();
      const made = suiteModelCalls() - before;
      if (made > 0 && !MODEL_SPECS.test(testInfo.file)) {
        throw new Error(
          `this test made ${made} Gemini call(s), but only the smoke specs may: a Spanish view of a seeded analysis or feedback needs its stored translation (rerun e2e/fixtures/capture-translations.ts if a fixture or TRANSLATION_PROMPT_VERSION changed)`,
        );
      }
    },
    { auto: true },
  ],
  cspWatch: [
    async ({ page }, use, testInfo) => {
      const lines: string[] = [];
      page.on("console", (message) => {
        const text = message.text();
        if (CSP_MESSAGE.test(text)) lines.push(text);
      });
      await use();
      if (!lines.length) return;
      const unique = [...new Set(lines)];
      testInfo.annotations.push({ type: "csp", description: `${unique.length} distinct message(s)` });
      mkdirSync(path.dirname(CSP_LOG), { recursive: true });
      appendFileSync(CSP_LOG, `## ${testInfo.titlePath.join(" › ")}\n${unique.join("\n")}\n\n`);
      console.log(`[e2e csp] ${testInfo.title}: ${unique.length} distinct CSP message(s)`);
      for (const line of unique) console.log(`[e2e csp]   ${line.slice(0, 400)}`);
    },
    { auto: true },
  ],
});
