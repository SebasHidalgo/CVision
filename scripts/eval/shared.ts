/**
 * What the analysis harness (run.ts) and the interview harness (interview.ts)
 * have in common: where runs live, how the engine behind a run is captured
 * and compared, and the small formatting helpers. Neither mode forks the
 * other; both are judged by the same comparability rule.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/error/errors";

export const EVAL_DIR = __dirname;
export const RUNS_DIR = path.join(EVAL_DIR, "runs");

// Provider, model, model version, sampling and token usage are private to
// lib/ai/client.ts. Its per-call metadata log line is the only place they
// surface, so they are read from it. The shape is pinned by client.test.ts.
export const AI_LOG_LINE =
  /\[CVision\]\[ai\] provider=(\S+) model=(\S+) ver=(\S+) temp=(\S+) seed=(\S+) ms=\d+ in=(\d+|\?) out=(\d+|\?)/;

/**
 * Two runs are only comparable when the same model answered under the same
 * sampling, close enough in time that the provider cannot have changed
 * underneath them. The alias we call has no dated snapshot to pin (every
 * dated form 404s), so "the same model" is as strong as the API lets us be,
 * and this window is the rest of the guarantee.
 */
export const MAX_SESSION_GAP_HOURS = 6;

/**
 * The identity of a run: which model answered and how it was sampled.
 * `apiModelVersion` is the dated build the models listing reports for the
 * alias (today "3.5-flash-lite-07-2026"); the response itself only echoes the
 * alias, so this field is the one that would change if the alias were
 * re-pointed under us.
 */
export type Engine = {
  provider: string | null;
  model: string | null;
  modelVersion: string | null;
  apiModelVersion: string | null;
  /** As sent: "0", or "provider" when no temperature was sent at all. */
  temperature: string | null;
  /** As sent: a number, or "none" when no seed was sent. */
  seed: string | null;
};

/** What every run record carries, whichever mode produced it. */
export type BaseRunRecord = {
  fixture: string;
  source: string;
  label: string;
  provider: string | null;
  model: string | null;
  engine?: Engine | null;
  generatedAt: string;
  durationMs: number;
  tokens: { input: number | null; output: number | null };
  result: { ok: true } | { ok: false; error: { name: string; code: string; message: string } };
};

/**
 * The dated build behind the model alias, from the free models listing - not
 * a generateContent call, so it costs nothing and bills nothing. The response
 * to an analysis only ever echoes the alias, so without this a re-pointed
 * alias would show up as unexplained variance, which is exactly what it did.
 */
export async function readApiModelVersion(model: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${apiKey}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    // Offline, or the endpoint moved. A run without it is still valid; it
    // just cannot be compared against one that has it.
    return null;
  }
}

export function captureAiLog() {
  const original = console.info;
  const meta: {
    provider: string | null;
    model: string | null;
    modelVersion: string | null;
    temperature: string | null;
    seed: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
  } = {
    provider: null,
    model: null,
    modelVersion: null,
    temperature: null,
    seed: null,
    inputTokens: null,
    outputTokens: null,
  };

  const count = (value: string) => (value === "?" ? null : Number(value));

  console.info = (...args: unknown[]) => {
    const match = AI_LOG_LINE.exec(args.map(String).join(" "));
    if (!match) return original(...args);
    meta.provider = match[1];
    meta.model = match[2];
    meta.modelVersion = match[3] === "?" ? null : match[3];
    meta.temperature = match[4];
    meta.seed = match[5];
    meta.inputTokens = count(match[6]);
    meta.outputTokens = count(match[7]);
  };

  return {
    meta,
    restore: () => {
      console.info = original;
    },
  };
}

/** The engine a capture saw, with the version lookup left to the caller. */
export function engineFrom(meta: ReturnType<typeof captureAiLog>["meta"]): Engine {
  return {
    provider: meta.provider,
    model: meta.model,
    modelVersion: meta.modelVersion,
    apiModelVersion: null,
    temperature: meta.temperature,
    seed: meta.seed,
  };
}

export function describeError(error: unknown) {
  // AppError messages are safe by construction (paths and timings only). Other
  // errors could carry input text, so only their type goes into the file.
  if (error instanceof AppError) {
    return { name: error.name, code: error.code, message: error.message };
  }
  console.error(error);
  return {
    name: error instanceof Error ? error.name : typeof error,
    code: "UNEXPECTED",
    message: "Unexpected error; see the console output of the run",
  };
}

/**
 * Refuses a comparison that cannot mean anything. Two runs are comparable
 * when the same provider, model, reported version and sampling produced them,
 * within one session - and M2d is why: the same prompt produced 55-60 on one
 * fixture across ten runs in one week and 25-75 the next, so a cross-session
 * delta measures the provider as much as the change.
 *
 * Runs captured before M2d carry no sampling record at all. Those are refused
 * by the same rule rather than by a special case: nobody can say how they
 * were sampled, which is the problem.
 */
export function requireComparable(
  runs: ReadonlyArray<readonly [string, Map<string, BaseRunRecord>]>,
  force: boolean,
) {
  const problems: string[] = [];
  const fingerprints = runs.map(([label, run]) => {
    const engine = [...run.values()].find((record) => record.engine)?.engine;
    return { label, engine, window: captureWindow(run) };
  });

  const unrecorded = fingerprints.filter(
    (one) => !one.engine || one.engine.temperature === null,
  );
  if (unrecorded.length) {
    problems.push(
      `no sampling recorded in ${unrecorded.map((one) => one.label).join(", ")} (captured before M2d; how it was sampled is unknown)`,
    );
  }

  const [first, ...rest] = fingerprints;
  for (const other of rest) {
    for (const key of [
      "provider",
      "model",
      "modelVersion",
      "apiModelVersion",
      "temperature",
      "seed",
    ] as const) {
      const a = first.engine?.[key] ?? null;
      const b = other.engine?.[key] ?? null;
      if (a !== b) {
        problems.push(
          `${key} differs: ${first.label}=${a ?? "unrecorded"} vs ${other.label}=${b ?? "unrecorded"}`,
        );
      }
    }
    const gapHours = sessionGapHours(first.window, other.window);
    if (gapHours !== null && gapHours > MAX_SESSION_GAP_HOURS) {
      problems.push(
        `captured ${gapHours.toFixed(1)} h apart (${first.label} and ${other.label}); the limit is ${MAX_SESSION_GAP_HOURS} h, because the model behind the alias can change without notice`,
      );
    }
  }

  if (problems.length === 0) return;

  const detail = problems.map((problem) => `  - ${problem}`).join("\n");
  if (!force) {
    fail(
      `These runs are not comparable:\n${detail}\n\nCapture a control arm in the same session instead:\n  AI_TEMPERATURE=provider npm run eval -- run <control-label>   (or set the change aside and re-run)\nOr pass --force to compare anyway and read every delta as unattributable.`,
    );
  }
  console.log(
    `!! FORCED COMPARISON - the deltas below are not attributable to any change:\n${detail}\n`,
  );
}

/** Earliest and latest record in a run, as epoch milliseconds. */
function captureWindow(run: Map<string, BaseRunRecord>): [number, number] | null {
  const times = [...run.values()]
    .map((record) => Date.parse(record.generatedAt))
    .filter((time) => Number.isFinite(time));
  return times.length ? [Math.min(...times), Math.max(...times)] : null;
}

/** Hours between the end of the earlier capture and the start of the later. */
function sessionGapHours(
  a: [number, number] | null,
  b: [number, number] | null,
): number | null {
  if (!a || !b) return null;
  const [earlier, later] = a[0] <= b[0] ? [a, b] : [b, a];
  return Math.max(0, later[0] - earlier[1]) / 3_600_000;
}

export function describeEngine(engine: Engine | null | undefined): string {
  if (!engine) return "Provider and model unknown.";
  return `Provider: ${engine.provider ?? "unknown"}, model: ${engine.model ?? "unknown"} (api version ${engine.apiModelVersion ?? "unknown"}), temperature ${engine.temperature ?? "unrecorded"}, seed ${engine.seed ?? "unrecorded"}.`;
}

/** Every record of a stored run, by fixture id. */
export async function readRunRecords<R extends { fixture: string }>(
  label: string,
): Promise<Map<string, R>> {
  const dir = path.join(RUNS_DIR, label);
  if (!existsSync(dir)) fail(`No run named "${label}" in ${display(RUNS_DIR)}.`);

  const records = new Map<string, R>();
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".json") || file === "_run.json") continue;
    const record = JSON.parse(await readFile(path.join(dir, file), "utf8")) as R;
    records.set(record.fixture, record);
  }
  return records;
}

export function identity(run: Map<string, BaseRunRecord>): string {
  const record = [...run.values()].find((candidate) => candidate.model !== null);
  if (!record) return "provider and model unknown";
  const engine = record.engine;
  return [
    `${record.provider} / ${record.model}`,
    engine?.apiModelVersion ? `api ${engine.apiModelVersion}` : null,
    `temp ${engine?.temperature ?? "unrecorded"}/seed ${engine?.seed ?? "unrecorded"}`,
    new Date(record.generatedAt).toISOString().slice(0, 16).replace("T", " "),
  ]
    .filter(Boolean)
    .join(", ");
}

export function parseFlags(args: string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = args[i + 1];
    if (name !== "force" && next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      i += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positional, flags };
}

export function truncate(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function formatScore(score: number): string {
  return String(Math.round(score * 10) / 10);
}

export function formatDelta(delta: number): string {
  if (delta === 0) return "0";
  return `${delta > 0 ? "+" : ""}${formatScore(delta)}`;
}

export function display(target: string): string {
  return path.relative(process.cwd(), target).split(path.sep).join("/");
}

export async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
