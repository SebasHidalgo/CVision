// The suite's app server: `next dev` with the Gemini ledger preloaded and dev tools on.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// The same .env the app reads; nothing already set is overridden.
try {
  for (const line of readFileSync(path.resolve(".env"), "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {
  // No .env: the guards below say what is missing.
}

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
  console.error("[e2e] GOOGLE_GENERATIVE_AI_API_KEY is not set: the smoke specs run a real analysis on it.");
  process.exit(1);
}
if (process.env.PADDLE_ENV !== "sandbox") {
  console.error("[e2e] PADDLE_ENV must be sandbox.");
  process.exit(1);
}

// A marker left by a killed server is removed; one whose process still runs stops this start.
const marker = path.resolve("e2e/.artifacts/gemini-ledger.json");
if (existsSync(marker)) {
  let pid = 0;
  try {
    pid = Number(JSON.parse(readFileSync(marker, "utf8")).pid) || 0;
  } catch {
    // Unreadable: stale.
  }
  let alive = false;
  try {
    alive = pid > 0 && process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (alive) {
    console.error(`[e2e] the suite's server is already running (pid ${pid}). Stop it first.`);
    process.exit(1);
  }
  rmSync(marker, { force: true });
  console.log(`[e2e] removed a stale server marker${pid ? ` (pid ${pid} is gone)` : ""}`);
}

const preload = path.resolve("e2e/support/gemini-ledger.cjs").replace(/\\/g, "/");
const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "dev"], {
  stdio: "inherit",
  // Flex: same measured latency as standard, half the price.
  env: { ...process.env, E2E_GEMINI_TIER: process.env.E2E_GEMINI_TIER ?? "flex", ALLOW_DEV_TOOLS: "1", NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require "${preload}"`.trim() },
});
// The specs check this marker: this launcher's pid lives exactly as long as the server it started.
mkdirSync(path.dirname(marker), { recursive: true });
writeFileSync(marker, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
const stop = () => {
  rmSync(marker, { force: true });
  child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  rmSync(marker, { force: true });
  process.exit(code ?? 0);
});
