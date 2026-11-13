// Preloaded into the e2e server only: prices each Gemini call into the eval ledger; 429 over the day cap.
const { appendFileSync, existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const GENERATE = /generativelanguage\.googleapis\.com\/.*:(generateContent|streamGenerateContent)/;
const LEDGER = (process.env.EVAL_SPEND_LEDGER && process.env.EVAL_SPEND_LEDGER.trim()) || path.join(process.cwd(), "scripts", "eval", "runs", "spend.jsonl");
const CAP = Number(process.env.EVAL_BUDGET_PER_DAY_USD || "1");
const TIER = process.env.E2E_GEMINI_TIER === "flex" ? "flex" : "standard";
const PRICES = JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "eval", "prices.json"), "utf8"));
const RUN_ID = `e2e-${randomUUID()}`;
const LABEL = `${process.env.EVAL_PHASE || "e2e"}-browser-suite`;
const MAX_ATTEMPTS = 3;
const RETRY_WAIT_MS = 3_000;

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

/** The eval's price; an unknown model at the dearest standard rate. */
function priceOf(model, tier) {
  const known = model && PRICES[model];
  if (known) return known[tier];
  const all = Object.entries(PRICES).filter(([name]) => name !== "about").map(([, prices]) => prices.standard);
  return all.reduce((worst, price) => (price.outputPerMillion > worst.outputPerMillion ? price : worst));
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
  let request = init || {};
  if (TIER === "flex" && typeof request.body === "string") request = { ...request, body: JSON.stringify({ ...JSON.parse(request.body), serviceTier: "flex" }) };
  let response;
  for (let attempt = 1; ; attempt++) {
    const startedAt = Date.now();
    response = await realFetch(input, request);
    const body = await response.clone().json().catch(() => null);
    record(url, response, body, Date.now() - startedAt);
    if (response.ok || ![429, 503].includes(response.status)) break;
    if (attempt === MAX_ATTEMPTS) {
      // Flex has no capacity promise: one last try at the standard price, so congestion does not fail the suite.
      if (TIER !== "flex" || response.status !== 503 || typeof init?.body !== "string") break;
      console.warn("[e2e][gemini] Flex answered 503 three times; this call goes on the standard tier");
      const startedAt = Date.now();
      response = await realFetch(input, init);
      record(url, response, await response.clone().json().catch(() => null), Date.now() - startedAt, "standard");
      break;
    }
    console.warn(`[e2e][gemini] answered HTTP ${response.status}; retrying (${attempt}/${MAX_ATTEMPTS - 1})`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS * attempt));
  }
  if (!response.ok) console.warn(`[e2e][gemini] answered HTTP ${response.status}`);
  return response;
};

function record(url, response, body, ms, asked = TIER) {
  const usage = body && body.usageMetadata;
  const n = (value) => (typeof value === "number" ? value : 0);
  const model = (/models\/([^:]+):/.exec(url) || [])[1] || null;
  // A failed call has no usage: record the tier it asked for.
  const served = !usage ? asked : usage.serviceTier === "flex" ? "flex" : "standard";
  const input = usage ? n(usage.promptTokenCount) : 0;
  const output = usage ? n(usage.candidatesTokenCount) + n(usage.thoughtsTokenCount) : 0;
  const price = priceOf(model, served);
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
      fixture: response.ok ? `browser-suite (${ms} ms)` : `browser-suite:http-${response.status}`,
      tier: served,
      model,
      input,
      output,
      costUsd: (input * price.inputPerMillion + output * price.outputPerMillion) / 1_000_000,
      source: "live",
    }) + "\n",
  );
}
