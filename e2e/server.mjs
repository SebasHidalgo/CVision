// The browser suite's app server: `next dev` with the Gemini ledger preloaded (free key only, every call in the
// eval spend ledger) and dev tools on (the room preview the layout check measures). Started by playwright.config.ts.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY_FREE?.trim()) {
  console.error("[e2e] GOOGLE_GENERATIVE_AI_API_KEY_FREE is not set: the browser suite runs its app on the free key only.");
  process.exit(1);
}
if (process.env.PADDLE_ENV !== "sandbox") {
  console.error("[e2e] PADDLE_ENV must be sandbox.");
  process.exit(1);
}

const preload = path.resolve("e2e/support/gemini-ledger.cjs").replace(/\\/g, "/");
const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "dev"], {
  stdio: "inherit",
  env: { ...process.env, ALLOW_DEV_TOOLS: "1", NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require "${preload}"`.trim() },
});
// The specs check this marker: this launcher's pid lives exactly as long as the server it started.
const marker = path.resolve("e2e/.artifacts/gemini-ledger.json");
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
