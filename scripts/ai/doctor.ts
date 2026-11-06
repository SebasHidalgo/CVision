/**
 * `npm run ai:doctor`: one minimal call to the configured model, reported as
 * OK, rate limited, billing exhausted, misconfigured or unavailable, with the
 * version string the response carries and the dated build the models listing
 * reports for the alias. Costs one tiny call. Exit code 1 unless OK.
 */
import { fixFor, runAiDoctor } from "@/lib/ai/doctor";

async function main() {
  const report = await runAiDoctor();
  const label = report.outcome === "ok" ? "PASS" : "FAIL";
  console.log(`${label}  ${report.outcome}: ${report.detail}`);
  if (report.ping) {
    console.log(`      provider ${report.ping.provider}, model ${report.ping.model}, response version ${report.ping.modelVersion ?? "?"}, listed build ${report.listedVersion ?? "?"}`);
  }
  const fix = fixFor(report.outcome);
  if (fix) console.log(`      -> ${fix}`);
  if (report.outcome !== "ok") process.exitCode = 1;
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`ai:doctor failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exit(1);
  });
}
