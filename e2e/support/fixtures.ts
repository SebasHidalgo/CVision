import { appendFileSync, mkdirSync } from "node:fs";
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

export const test = base.extend<{ cspWatch: void }>({
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
