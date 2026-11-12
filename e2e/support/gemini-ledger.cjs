// Preloaded into the e2e app server (node --require, see e2e/server.mjs); never part of the app or a deployment.
// The suite sends invented data only, so every Gemini call goes out on the free key and is written to the eval
// spend ledger (scripts/eval/runs/spend.jsonl, or EVAL_SPEND_LEDGER), where `npm run eval -- spend` reports it
// and the day's cap counts it. A call made over the day's cap is refused here with a 429, before it leaves.
const { appendFileSync, existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const GENERATE = /generativelanguage\.googleapis\.com\/.*:(generateContent|streamGenerateContent)/;
const FREE_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY_FREE && process.env.GOOGLE_GENERATIVE_AI_API_KEY_FREE.trim();
const LEDGER = (process.env.EVAL_SPEND_LEDGER && process.env.EVAL_SPEND_LEDGER.trim()) || path.join(process.cwd(), "scripts", "eval", "runs", "spend.jsonl");
const CAP = Number(process.env.EVAL_BUDGET_PER_DAY_USD || "1");
const RUN_ID = `e2e-${randomUUID()}`;
const LABEL = `${process.env.EVAL_PHASE || "e2e"}-browser-suite`;

if (!FREE_KEY) throw new Error("[e2e] GOOGLE_GENERATIVE_AI_API_KEY_FREE is not set: the browser suite runs on the free key only");

const utcDay = (date) => date.toISOString().slice(0, 10);
function spentToday() {
  if (!existsSync(LEDGER)) return 0;
  const day = utcDay(new Date());
  return readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((row) => row.source === "live" && row.day === day)
    .reduce((sum, row) => sum + (row.costUsd || 0), 0);
}


const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!GENERATE.test(url)) return realFetch(input, init);
  const spent = spentToday();
  if (spent >= CAP) {
    console.error(`[e2e][gemini] refused: USD ${spent.toFixed(4)} spent today (UTC) >= EVAL_BUDGET_PER_DAY_USD ${CAP}`);
    return new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "e2e day cap reached" } }), { status: 429, headers: { "content-type": "application/json" } });
  }
  const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
  headers.set("x-goog-api-key", FREE_KEY);
  const response = await realFetch(input, { ...(init || {}), headers });
  const body = await response.clone().json().catch(() => null);
  const usage = body && body.usageMetadata;
  const n = (value) => (typeof value === "number" ? value : 0);
  const now = new Date();
  appendFileSync(
    LEDGER,
    JSON.stringify({
      at: now.toISOString(),
      day: utcDay(now),
      command: "e2e",
      label: LABEL,
      phase: process.env.EVAL_PHASE || "e2e",
      runId: RUN_ID,
      fixture: response.ok ? "browser-suite" : `browser-suite:http-${response.status}`,
      tier: "free",
      model: (/models\/([^:]+):/.exec(url) || [])[1] || null,
      input: usage ? n(usage.promptTokenCount) : 0,
      output: usage ? n(usage.candidatesTokenCount) + n(usage.thoughtsTokenCount) : 0,
      costUsd: 0,
      source: "live",
    }) + "\n",
  );
  if (!response.ok) console.warn(`[e2e][gemini] free key answered HTTP ${response.status}`);
  return response;
};
