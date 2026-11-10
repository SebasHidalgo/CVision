/**
 * Spend control for every eval command that calls a model: which key and
 * tier each fixture uses, what each call cost (from the tokens the API
 * reports), a local ledger of it (runs/spend.jsonl, gitignored), and hard
 * caps that refuse a run before it starts and stop it mid-run.
 *
 * Routing lives here, not in lib/ai/client.ts: the harness wraps fetch, so
 * production requests stay byte-identical. Invented data (the committed
 * fixtures) goes to the free key; real data (fixtures.local/) never does.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { rateLimitDetails } from "@/lib/ai/client";
import { costOf, type Tier } from "./pricing";
import { fail, RUNS_DIR } from "./shared";

type Env = Record<string, string | undefined>;

export const FREE_KEY_ENV = "GOOGLE_GENERATIVE_AI_API_KEY_FREE";
export const DEFAULT_BUDGET = { perRunUsd: 0.5, perDayUsd: 1 } as const;
// Free-tier limits for this model are not published; one call every 6 s stays under 10 RPM.
export const FREE_MIN_INTERVAL_MS = 6_000;
export const MAX_ATTEMPTS = 3;

export const ledgerFile = () => process.env.EVAL_SPEND_LEDGER?.trim() || path.join(RUNS_DIR, "spend.jsonl");

export type SpendRow = {
  at: string;
  day: string;
  command: string;
  label: string;
  phase: string;
  /** One process run; a label's fixture can be run more than once (canaries). */
  runId: string;
  fixture: string;
  tier: Tier;
  model: string | null;
  input: number;
  output: number;
  costUsd: number;
  source: "live" | "backfill";
};

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

/** The roadmap phase a label belongs to: EVAL_PHASE, else its "m8g"-style prefix. */
export function phaseOf(label: string, env: Env = process.env): string {
  const set = env.EVAL_PHASE?.trim();
  if (set) return set;
  const canary = label.replace(/^canary-/, "");
  return /^(m\d+[a-z]?)(?=-|$)/i.exec(canary)?.[1].toLowerCase() ?? "other";
}

export function readLedger(file = ledgerFile()): SpendRow[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as SpendRow);
}

export function appendLedger(rows: SpendRow[], file = ledgerFile()) {
  if (rows.length) appendFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

// ---------------------------------------------------------------- caps

export type Budget = { perRunUsd: number; perDayUsd: number };

export function readBudget(env: Env = process.env): Budget {
  const read = (name: string, fallback: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
    fail(`${name}=${raw} is not a non-negative number of USD.`);
  };
  return {
    perRunUsd: read("EVAL_BUDGET_PER_RUN_USD", DEFAULT_BUDGET.perRunUsd),
    perDayUsd: read("EVAL_BUDGET_PER_DAY_USD", DEFAULT_BUDGET.perDayUsd),
  };
}

/** Live spend on a UTC day; backfilled history is reported, never capped. */
export function spentOnDay(rows: SpendRow[], day: string): number {
  return rows.filter((row) => row.source === "live" && row.day === day).reduce((sum, row) => sum + row.costUsd, 0);
}

export const usd = (value: number) => `USD ${value.toFixed(value < 0.1 ? 4 : 3)}`;

/** Refuses work that would cross a cap; re-reads the ledger so parallel runs count too. */
export class SpendGuard {
  constructor(
    readonly budget: Budget,
    readonly runId: string,
    private readonly read: () => SpendRow[] = () => readLedger(),
    private readonly today: () => string = () => utcDay(),
  ) {}

  spentThisRun(rows = this.read()): number {
    return rows.filter((row) => row.runId === this.runId).reduce((sum, row) => sum + row.costUsd, 0);
  }

  /** Why work of this estimated cost may not start, or null. */
  refuse(estimateUsd: number): string | null {
    if (estimateUsd <= 0) return null;
    const rows = this.read();
    const run = this.spentThisRun(rows);
    const day = spentOnDay(rows, this.today());
    if (run + estimateUsd > this.budget.perRunUsd + 1e-9) {
      return `the run cap: ${usd(run)} spent + ${usd(estimateUsd)} estimated > EVAL_BUDGET_PER_RUN_USD ${usd(this.budget.perRunUsd)}`;
    }
    if (day + estimateUsd > this.budget.perDayUsd + 1e-9) {
      return `the day cap: ${usd(day)} spent today (UTC) + ${usd(estimateUsd)} estimated > EVAL_BUDGET_PER_DAY_USD ${usd(this.budget.perDayUsd)}`;
    }
    return null;
  }
}

// ---------------------------------------------------------------- estimate

export type Workload = "analysis" | "interview";
// No history: an analysis with a repair call measured about 7,000 in / 4,600 out in M8-F.
const DEFAULT_TOKENS: Record<Workload, { input: number; output: number }> = {
  analysis: { input: 8_000, output: 5_000 },
  interview: { input: 6_000, output: 3_000 },
};

/** The largest single run of this fixture in the ledger (all its calls), or a default. */
export function expectedTokens(rows: SpendRow[], fixture: string, workload: Workload) {
  const totals = new Map<string, { input: number; output: number }>();
  for (const row of rows) {
    if (row.fixture !== fixture) continue;
    const key = `${row.runId}\u0000${row.label}`;
    const sum = totals.get(key) ?? { input: 0, output: 0 };
    totals.set(key, { input: sum.input + row.input, output: sum.output + row.output });
  }
  if (!totals.size) return DEFAULT_TOKENS[workload];
  return [...totals.values()].reduce((max, one) => ({ input: Math.max(max.input, one.input), output: Math.max(max.output, one.output) }));
}

export function estimateUsd(rows: SpendRow[], fixture: string, workload: Workload, model: string | null, tier: Tier): number {
  const tokens = expectedTokens(rows, fixture, workload);
  return costOf(model, tier, tokens.input, tokens.output);
}

// ---------------------------------------------------------------- routing

export function paidTier(env: Env = process.env): Tier {
  const raw = env.EVAL_PAID_TIER?.trim() || "flex";
  if (raw !== "flex" && raw !== "standard") fail(`EVAL_PAID_TIER must be flex or standard, not "${raw}".`);
  return raw;
}

export function parseTier(raw: string | true | undefined): Tier | undefined {
  if (raw === undefined) return undefined;
  if (raw === "standard" || raw === "flex" || raw === "free") return raw;
  fail(`--tier must be standard, flex or free, not "${String(raw)}".`);
}

/** The tier a fixture runs on: invented data on the free key, real data always paid. */
export function planTier(
  source: string,
  override: Tier | undefined,
  env: Env = process.env,
): { tier: Tier; note?: string } {
  const hasFree = Boolean(env[FREE_KEY_ENV]?.trim());
  if (source !== "synthetic") {
    if (override === "free") fail("Real-data fixtures never go to the free tier: Google may use what it is sent.");
    return { tier: override ?? paidTier(env) };
  }
  if (override === "free" && !hasFree) fail(`--tier free needs ${FREE_KEY_ENV} in .env.`);
  if (override) return { tier: override };
  if (hasFree) return { tier: "free" };
  return { tier: paidTier(env), note: `${FREE_KEY_ENV} is not set: synthetic fixtures run on the paid key` };
}

type Failure = { status: number | "network"; retryDelayMs: number | null; perDay: boolean };

type CallContext = {
  command: string;
  label: string;
  runId: string;
  fixture: string;
  tier: Tier;
  served: Tier[];
  failures: Failure[];
};

let active: CallContext | null = null;
let lastFreeCall = 0;
let installed = false;

export function beginCalls(ctx: Omit<CallContext, "served" | "failures">) {
  active = { command: ctx.command, label: ctx.label, runId: ctx.runId, fixture: ctx.fixture, tier: ctx.tier, served: [], failures: [] };
}

export function endCalls(): { served: Tier[]; failures: Failure[] } {
  const ended = active ?? { served: [], failures: [] };
  active = null;
  return { served: ended.served, failures: ended.failures };
}

const GENERATE = /generativelanguage\.googleapis\.com\/.*:generateContent/;

/** The request as the tier needs it: the free key swapped in, or Flex asked for. Pure. */
export function routeRequest(init: RequestInit | undefined, tier: Tier, freeKey: string | undefined): RequestInit | undefined {
  if (!init || tier === "standard") return init;
  if (tier === "free") {
    if (!freeKey) throw new Error(`${FREE_KEY_ENV} is not set`);
    const headers = new Headers(init.headers);
    headers.set("x-goog-api-key", freeKey);
    return { ...init, headers };
  }
  if (typeof init.body !== "string") return init;
  const body = JSON.parse(init.body) as Record<string, unknown>;
  return { ...init, body: JSON.stringify({ ...body, serviceTier: "flex" }) };
}

/** Tokens and served tier from a generateContent body; output includes thinking. */
export function usageFrom(body: unknown): { input: number; output: number; served: string | null } | null {
  const usage = (body as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  if (!usage) return null;
  const n = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    input: n(usage.promptTokenCount),
    output: n(usage.candidatesTokenCount) + n(usage.thoughtsTokenCount),
    served: typeof usage.serviceTier === "string" ? usage.serviceTier : null,
  };
}

/** How long a 429 asks to wait, and whether the daily quota is the one exhausted. */
export function failureFrom(status: number, body: unknown): Failure {
  if (status !== 429) return { status, retryDelayMs: null, perDay: false };
  const details = rateLimitDetails(body, undefined);
  const seconds = /^(\d+(?:\.\d+)?)s$/.exec(details.retryDelay)?.[1];
  return { status, retryDelayMs: seconds ? Math.ceil(Number(seconds) * 1000) : null, perDay: /PerDay/i.test(details.quotaId) };
}

/** Wraps fetch once per process: routes model calls and writes one ledger row per call. */
export function installEvalFetch() {
  if (installed) return;
  installed = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const ctx = active;
    if (!ctx || !GENERATE.test(url)) return realFetch(input, init);
    if (ctx.tier === "free") {
      const wait = lastFreeCall + FREE_MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastFreeCall = Date.now();
    }
    let response: Response;
    try {
      response = await realFetch(input, routeRequest(init, ctx.tier, process.env[FREE_KEY_ENV]?.trim()));
    } catch (error) {
      ctx.failures.push({ status: "network", retryDelayMs: null, perDay: false });
      throw error;
    }
    const body = await response.clone().json().catch(() => null);
    if (!response.ok) {
      ctx.failures.push(failureFrom(response.status, body));
      return response;
    }
    const usage = usageFrom(body);
    const model = /models\/([^:]+):/.exec(url)?.[1] ?? null;
    const tier: Tier = ctx.tier === "free" ? "free" : usage?.served === "flex" ? "flex" : "standard";
    if (ctx.tier === "flex" && tier !== "flex") console.warn(`[eval] ${ctx.fixture}: asked for flex, served ${usage?.served ?? "?"}; billed as standard`);
    ctx.served.push(tier);
    const now = new Date();
    appendLedger([
      {
        at: now.toISOString(),
        day: utcDay(now),
        command: ctx.command,
        label: ctx.label,
        phase: phaseOf(ctx.label),
        runId: ctx.runId,
        fixture: ctx.fixture,
        tier,
        model,
        input: usage?.input ?? 0,
        output: usage?.output ?? 0,
        costUsd: costOf(model, tier, usage?.input ?? 0, usage?.output ?? 0),
        source: "live",
      },
    ]);
    return response;
  };
}

/** The tier a record was served on: one value, or "mixed". */
export function servedTier(served: Tier[]): Tier | "mixed" | null {
  const unique = [...new Set(served)];
  return unique.length === 0 ? null : unique.length === 1 ? unique[0] : "mixed";
}

/** Whether a fixture's calls failed in a way worth one more attempt, and how long to wait first. */
export function retryAfter(failures: Failure[], attempt: number): { retry: boolean; waitMs: number; perDay: boolean } {
  const transient = failures.filter((f) => f.status === 429 || f.status === 503 || f.status === 500 || f.status === "network");
  if (!transient.length) return { retry: false, waitMs: 0, perDay: false };
  if (transient.some((f) => f.perDay)) return { retry: false, waitMs: 0, perDay: true };
  const asked = Math.max(0, ...transient.map((f) => f.retryDelayMs ?? 0));
  return { retry: attempt < MAX_ATTEMPTS, waitMs: Math.min(120_000, Math.max(asked, 15_000 * attempt)), perDay: false };
}

type RoutedRecord = { engine?: { tier?: string | null } | null; attempts?: number; callFailures?: string[] };

/** One fixture under the caps on its tier, retried on rate limits and capacity errors. */
export async function runRouted<R extends RoutedRecord>(
  plan: { command: string; label: string; runId: string; fixture: string; tier: Tier; estimateUsd: number },
  guard: SpendGuard,
  run: () => Promise<R>,
): Promise<{ record?: R; stopped?: string }> {
  for (let attempt = 1; ; attempt += 1) {
    const refusal = guard.refuse(plan.estimateUsd);
    if (refusal) return { stopped: `before ${plan.fixture}: ${refusal}` };
    beginCalls(plan);
    let record: R;
    let calls: ReturnType<typeof endCalls>;
    try {
      record = await run();
    } finally {
      calls = endCalls();
    }
    if (record.engine) record.engine.tier = servedTier(calls.served) ?? plan.tier;
    record.attempts = attempt;
    if (calls.failures.length) record.callFailures = calls.failures.map((f) => String(f.status));
    const next = retryAfter(calls.failures, attempt);
    if (next.perDay) return { record, stopped: `at ${plan.fixture}: the ${plan.tier} daily quota is exhausted` };
    if (!next.retry) return { record };
    console.log(`  ${plan.fixture}: ${calls.failures.map((f) => f.status).join(", ")} on ${plan.tier}; attempt ${attempt + 1} in ${Math.round(next.waitMs / 1000)} s`);
    await new Promise((resolve) => setTimeout(resolve, next.waitMs));
  }
}

// ---------------------------------------------------------------- reporting

export async function spendCommand(args: string[]) {
  const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : undefined;
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) fail("--since needs a date as YYYY-MM-DD.");
  if (args.includes("--backfill")) await backfill();

  const rows = readLedger().filter((row) => !since || row.day >= since);
  if (!rows.length) {
    console.log(`No spend recorded${since ? ` since ${since}` : ""} in ${ledgerFile()}.`);
    return;
  }
  const table = (title: string, keyOf: (row: SpendRow) => string) => {
    const groups = new Map<string, SpendRow[]>();
    for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
    console.log(`\n${title}`);
    for (const [key, group] of [...groups.entries()].sort()) {
      const by = (tier: Tier) => group.filter((row) => row.tier === tier).reduce((sum, row) => sum + row.costUsd, 0);
      const total = group.reduce((sum, row) => sum + row.costUsd, 0);
      const live = group.some((row) => row.source === "live") ? "" : " (backfill)";
      console.log(
        `  ${key.padEnd(14)} ${String(group.length).padStart(5)} calls  ${usd(total).padStart(12)}   standard ${usd(by("standard"))}  flex ${usd(by("flex"))}  free ${group.filter((row) => row.tier === "free").length} calls${live}`,
      );
    }
  };
  table("By UTC day", (row) => row.day);
  table("By phase", (row) => row.phase);
  table("By tier", (row) => row.tier);
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const budget = readBudget();
  console.log(`\nTotal ${usd(total)} over ${rows.length} calls${since ? ` since ${since}` : ""}.`);
  console.log(`Today (UTC ${utcDay()}): ${usd(spentOnDay(readLedger(), utcDay()))} of EVAL_BUDGET_PER_DAY_USD ${usd(budget.perDayUsd)}; per run ${usd(budget.perRunUsd)}.`);
}

/**
 * Adds every stored run's tokens to the ledger once, priced at standard:
 * every run before M8-G was a paid standard call. A replay copies its
 * source's calls, so records are keyed by fixture, time and tokens.
 */
async function backfill() {
  const existing = readLedger();
  const seen = new Set(existing.filter((row) => row.source === "backfill").map((row) => `${row.fixture}|${row.at}`));
  const live = new Set(existing.filter((row) => row.source === "live").map((row) => row.runId));
  const rows: SpendRow[] = [];
  let records = 0;
  let unpriced = 0;
  for (const label of (await readdir(RUNS_DIR, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    for (const file of (await readdir(path.join(RUNS_DIR, label))).filter((f) => f.endsWith(".json") && f !== "_run.json")) {
      const record = JSON.parse(await readFile(path.join(RUNS_DIR, label, file), "utf8")) as {
        fixture?: string;
        generatedAt?: string;
        model?: string | null;
        tokens?: { input: number | null; output: number | null };
      };
      if (!record.fixture || !record.generatedAt || !record.tokens) continue;
      records += 1;
      const key = `${record.fixture}|${record.generatedAt}`;
      if (seen.has(key) || live.has(label)) continue;
      seen.add(key);
      if (record.tokens.input === null || record.tokens.output === null) {
        unpriced += 1;
        continue;
      }
      rows.push({
        at: record.generatedAt,
        day: record.generatedAt.slice(0, 10),
        command: label.includes("canary") ? "canary" : "run",
        label,
        phase: phaseOf(label, {}),
        runId: label,
        fixture: record.fixture,
        tier: "standard",
        model: record.model ?? null,
        input: record.tokens.input,
        output: record.tokens.output,
        costUsd: costOf(record.model ?? null, "standard", record.tokens.input, record.tokens.output),
        source: "backfill",
      });
    }
  }
  appendLedger(rows);
  console.log(`Backfill: ${records} stored record(s) read, ${rows.length} new call(s) added, ${unpriced} without token counts skipped.`);
}
