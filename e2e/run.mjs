// Runs the browser suite's tiers in order and times each: `node e2e/run.mjs [fast|external|all]`.
// The model tier runs alone after the others: its Gemini calls would fail the model-call guard of any test running beside it.
// Every tier runs even when an earlier one fails; the exit code is 1 if any did. Extra arguments go to Playwright.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const [which = "all", ...extra] = process.argv.slice(2);
const TIERS = {
  fast: [["fast", "fast-es"]],
  external: [["external", "external-es"], ["model", "model-es"]],
};
const steps = which === "all" ? [...TIERS.fast, ...TIERS.external] : TIERS[which];
if (!steps) {
  console.error(`[e2e] unknown tier "${which}": fast, external or all`);
  process.exit(2);
}

const cli = path.resolve("node_modules/@playwright/test/cli.js");
const results = [];
const began = Date.now();

// One server for every step: a server Playwright started would stop after each step, and the next would compile cold.
const up = async () => {
  try {
    return (await fetch("http://localhost:3000/pricing", { signal: AbortSignal.timeout(120_000) })).ok;
  } catch {
    return false;
  }
};
let server = null;
if (!process.env.E2E_NO_SERVER && !(await up())) {
  console.log("[e2e] starting the suite's server (e2e/server.mjs)");
  server = spawn(process.execPath, [path.resolve("e2e/server.mjs")], { stdio: ["ignore", "inherit", "inherit"] });
  // It builds first: a few minutes.
  const deadline = Date.now() + 600_000;
  while (!(await up())) {
    if (Date.now() > deadline || server.exitCode !== null) {
      console.error("[e2e] the server did not come up in ten minutes");
      server.kill();
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

for (const projects of steps) {
  const startedAt = Date.now();
  const args = [cli, "test", ...projects.flatMap((project) => ["--project", project]), ...extra];
  console.log(`\n[e2e] ${projects.join(" + ")}: playwright ${args.slice(1).join(" ")}`);
  // One HTML report per step, so a later step does not replace an earlier one's.
  const run = spawnSync(process.execPath, args, { stdio: "inherit", env: { ...process.env, E2E_NO_SERVER: "1", E2E_REPORT_DIR: `e2e/.artifacts/report-${projects[0]}` } });
  results.push({ step: projects[0], ok: run.status === 0, seconds: Math.round((Date.now() - startedAt) / 1000) });
}
server?.kill();

const minutes = (seconds) => `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
console.log("\n[e2e] summary");
for (const result of results) console.log(`  ${result.ok ? "passed" : "FAILED"}  ${result.step.padEnd(9)} ${minutes(result.seconds)}`);
console.log(`  wall time ${minutes(Math.round((Date.now() - began) / 1000))}`);
process.exit(results.every((result) => result.ok) ? 0 : 1);
