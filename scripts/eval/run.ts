/**
 * Evaluation harness for the resume analysis. Runs the same model call as
 * analyzeResumeAction over fixed fixtures and writes the validated output, one
 * file per fixture, so runs before and after a provider change can be compared.
 *
 * Skips everything that isn't the model: PDF extraction, storage, DB and auth.
 * Run it through `npm run eval`, which resolves `server-only` the way Next does.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateJson } from "@/lib/ai/client";
import { resumeAnalysisPrompt } from "@/lib/ai/prompts/cv-analysis.prompt";
import { AppError } from "@/lib/error/errors";
import {
  MAX_JOB_DESCRIPTION_CHARS,
  resumeFeedbackSchema,
  type ResumeAnalysisFeedback,
} from "@/lib/schemas/resumeSchema";
import { scoreTone, type ScoreTone } from "@/lib/score";

// Mirrors screens/ResumeUpload/actions/analyzeResumeAction.ts, where these are
// not exported. Keep them in sync.
const MAX_RESUME_TEXT_CHARS = 20_000;
const ANALYSIS_TIMEOUT_MS = 90_000;

const EVAL_DIR = __dirname;
const RUNS_DIR = path.join(EVAL_DIR, "runs");
const FIXTURE_SOURCES = [
  { dir: path.join(EVAL_DIR, "fixtures"), source: "synthetic" },
  { dir: path.join(EVAL_DIR, "fixtures.local"), source: "local" },
] as const;

// Provider and model are private constants of lib/ai/client.ts. Its per-call
// metadata log line is the only place they surface, so they are read from it.
// The line's shape is pinned by lib/ai/client.test.ts.
const AI_LOG_LINE = /\[CVision\]\[ai\] provider=(\S+) model=(\S+)/;

type FixtureMeta = {
  jobTitle: string;
  expectedFit?: ScoreTone;
  purpose?: string;
};

type Fixture = FixtureMeta & {
  id: string;
  source: "synthetic" | "local";
  cvText: string;
  jobDescription: string;
};

type RunRecord = {
  fixture: string;
  source: Fixture["source"];
  label: string;
  provider: string | null;
  model: string | null;
  generatedAt: string;
  durationMs: number;
  input: {
    jobTitle: string;
    expectedFit: ScoreTone | null;
    cvChars: number;
    cvCharsSent: number;
    cvTruncated: boolean;
    jobChars: number;
  };
  result:
    | { ok: true; feedback: ResumeAnalysisFeedback }
    | { ok: false; error: { name: string; code: string; message: string } };
};

const USAGE = `CVision analysis eval: run the resume analysis over fixed fixtures and
compare model output across provider changes.

Usage:
  npm run eval -- run <label> [--only <id,id>] [--timeout <ms>] [--force]
  npm run eval -- compare <labelA> <labelB>
  npm run eval -- list

Workflow for a provider migration:
  1. Before the swap (Ollama running, model pulled), capture a baseline, twice:
       npm run eval -- run baseline
       npm run eval -- run baseline-2
     Compare those two first: the model is not deterministic, and their
     difference is the noise floor any later change must be read against.
       npm run eval -- compare baseline baseline-2
  2. Swap the provider in lib/ai/client.ts, then run the same fixtures:
       npm run eval -- run after-swap
  3. Compare scores side by side:
       npm run eval -- compare baseline after-swap
     Full output diff:
       git diff --no-index scripts/eval/runs/baseline scripts/eval/runs/after-swap

Fixtures:  scripts/eval/fixtures/<id>/        synthetic, committed
           scripts/eval/fixtures.local/<id>/  gitignored: put real CVs here
           each holds cv.txt, job.txt and fixture.json ({ "jobTitle", "expectedFit"? })
Output:    scripts/eval/runs/<label>/<id>.json (gitignored)

Each fixture is one model call, run sequentially, with the same prompt, schema,
${MAX_RESUME_TEXT_CHARS.toLocaleString("en-US")}-char CV truncation and ${ANALYSIS_TIMEOUT_MS / 1000} s timeout as analyzeResumeAction.`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;

  switch (command) {
    case "run":
      return runCommand(rest);
    case "compare":
      return compareCommand(rest);
    case "list":
      return listCommand();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    default:
      fail(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

// ---------------------------------------------------------------- run

async function runCommand(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const label = positional[0];
  if (!label || !/^[\w.-]+$/.test(label)) {
    fail(`run needs a label made of letters, digits, "-", "_" or ".".\n\n${USAGE}`);
  }

  const outDir = path.join(RUNS_DIR, label);
  if (existsSync(outDir)) {
    if (!flags.has("force")) {
      fail(
        `${display(outDir)} already exists. Pick another label, or pass --force to overwrite it.`,
      );
    }
    // Start clean: a file left from an earlier run would be compared as if it
    // belonged to this one.
    await rm(outDir, { recursive: true });
  }

  const timeoutMs = flags.has("timeout")
    ? Number(flags.get("timeout"))
    : ANALYSIS_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    fail("--timeout must be a positive integer number of milliseconds.");
  }

  const only = flags.get("only");
  const fixtures = (await loadFixtures()).filter(
    (fixture) =>
      typeof only !== "string" || only.split(",").includes(fixture.id),
  );
  if (fixtures.length === 0) fail("No fixtures matched.");

  await mkdir(outDir, { recursive: true });
  console.log(
    `Running ${fixtures.length} fixture(s) into ${display(outDir)} (timeout ${timeoutMs} ms per call)\n`,
  );

  const startedAt = new Date().toISOString();
  const records: RunRecord[] = [];

  for (const fixture of fixtures) {
    const record = await runFixture(fixture, label, timeoutMs);
    await writeJson(path.join(outDir, `${fixture.id}.json`), record);
    console.log(formatProgress(record));
    records.push(record);
  }

  const identified = records.find((record) => record.model !== null);
  await writeJson(path.join(outDir, "_run.json"), {
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    provider: identified?.provider ?? null,
    model: identified?.model ?? null,
    timeoutMs,
    node: process.version,
    fixtures: records.map(({ fixture, result, durationMs }) => ({
      fixture,
      ok: result.ok,
      durationMs,
    })),
  });

  const okCount = records.filter((record) => record.result.ok).length;
  console.log(
    `\n${okCount}/${records.length} succeeded. Provider: ${identified?.provider ?? "unknown"}, model: ${identified?.model ?? "unknown"}.`,
  );
  if (!identified) {
    console.warn(
      "Warning: provider and model were not captured. lib/ai/client.ts no longer logs its metadata line.",
    );
  }
}

async function runFixture(
  fixture: Fixture,
  label: string,
  timeoutMs: number,
): Promise<RunRecord> {
  const resumeText = fixture.cvText.slice(0, MAX_RESUME_TEXT_CHARS);
  const aiLog = captureAiLog();
  const startedAt = Date.now();
  let result: RunRecord["result"];

  try {
    const feedback = await generateJson({
      prompt: resumeAnalysisPrompt({
        jobTitle: fixture.jobTitle,
        jobDescription: fixture.jobDescription,
        resumeText,
      }),
      schema: resumeFeedbackSchema,
      timeoutMs,
    });
    result = { ok: true, feedback };
  } catch (error) {
    result = { ok: false, error: describeError(error) };
  } finally {
    aiLog.restore();
  }

  return {
    fixture: fixture.id,
    source: fixture.source,
    label,
    provider: aiLog.meta.provider,
    model: aiLog.meta.model,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    input: {
      jobTitle: fixture.jobTitle,
      expectedFit: fixture.expectedFit ?? null,
      cvChars: fixture.cvText.length,
      cvCharsSent: resumeText.length,
      cvTruncated: resumeText.length < fixture.cvText.length,
      jobChars: fixture.jobDescription.length,
    },
    result,
  };
}

function captureAiLog() {
  const original = console.info;
  const meta: { provider: string | null; model: string | null } = {
    provider: null,
    model: null,
  };

  console.info = (...args: unknown[]) => {
    const match = AI_LOG_LINE.exec(args.map(String).join(" "));
    if (!match) return original(...args);
    meta.provider = match[1];
    meta.model = match[2];
  };

  return {
    meta,
    restore: () => {
      console.info = original;
    },
  };
}

function describeError(error: unknown) {
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

function formatProgress(record: RunRecord): string {
  const seconds = `${(record.durationMs / 1000).toFixed(1)} s`;
  const id = record.fixture.padEnd(26);

  if (!record.result.ok) {
    return `  ${id} FAIL  ${record.result.error.code.padEnd(28)} ${seconds}`;
  }

  const score = record.result.feedback.overall.globalScore;
  return `  ${id} ok    ${formatScore(score).padStart(5)}  ${bandNote(score, record.input.expectedFit).padEnd(20)} ${seconds}`;
}

// ---------------------------------------------------------------- compare

const SCORE_ROWS: Array<[string, (feedback: ResumeAnalysisFeedback) => number]> = [
  ["Global", (f) => f.overall.globalScore],
  ["ATS", (f) => f.atsCompatibility.score],
  ["Experience", (f) => f.experienceAndImpact.score],
  ["Skills", (f) => f.skills.score],
  ["Education", (f) => f.educationAndCertifications.score],
  ["Tone", (f) => f.toneAndClarity.score],
  ["Job fit", (f) => f.jobFit.score],
  ["Readability", (f) => f.toneAndClarity.readability],
];

async function compareCommand(args: string[]) {
  const [labelA, labelB] = parseFlags(args).positional;
  if (!labelA || !labelB) fail(`compare needs two labels.\n\n${USAGE}`);

  const runA = await readRun(labelA);
  const runB = await readRun(labelB);

  console.log(`A = ${labelA}  (${identity(runA)})`);
  console.log(`B = ${labelB}  (${identity(runB)})`);

  const ids = [...new Set([...runA.keys(), ...runB.keys()])].sort();
  const globalDeltas: number[] = [];
  let expectedHitsA = 0;
  let expectedHitsB = 0;
  let withExpectation = 0;

  for (const id of ids) {
    const a = runA.get(id);
    const b = runB.get(id);
    const expected = (a ?? b)?.input.expectedFit ?? null;
    console.log(`\n${id}${expected ? `  (expected fit: ${expected})` : ""}`);

    if (!a || !b) {
      console.log(`  only in ${a ? "A" : "B"}`);
      continue;
    }
    if (!a.result.ok || !b.result.ok) {
      console.log(`  A: ${statusOf(a)}   B: ${statusOf(b)}`);
      continue;
    }

    const fa = a.result.feedback;
    const fb = b.result.feedback;
    console.log(`  ${"".padEnd(12)}${"A".padStart(7)}${"B".padStart(7)}${"Δ".padStart(8)}`);
    for (const [name, pick] of SCORE_ROWS) {
      const delta = pick(fb) - pick(fa);
      console.log(
        `  ${name.padEnd(12)}${formatScore(pick(fa)).padStart(7)}${formatScore(pick(fb)).padStart(7)}${formatDelta(delta).padStart(8)}`,
      );
    }
    console.log(
      `  Fit band    A: ${bandNote(fa.overall.globalScore, expected)}   B: ${bandNote(fb.overall.globalScore, expected)}`,
    );
    console.log(`  Verdict     A: ${fa.overall.verdict}   B: ${fb.overall.verdict}`);
    console.log(
      `  Time        A: ${(a.durationMs / 1000).toFixed(1)} s   B: ${(b.durationMs / 1000).toFixed(1)} s`,
    );

    globalDeltas.push(Math.abs(fb.overall.globalScore - fa.overall.globalScore));
    if (expected) {
      withExpectation += 1;
      if (scoreTone(fa.overall.globalScore) === expected) expectedHitsA += 1;
      if (scoreTone(fb.overall.globalScore) === expected) expectedHitsB += 1;
    }
  }

  const okA = [...runA.values()].filter((record) => record.result.ok).length;
  const okB = [...runB.values()].filter((record) => record.result.ok).length;
  const meanDelta = globalDeltas.length
    ? globalDeltas.reduce((sum, delta) => sum + delta, 0) / globalDeltas.length
    : null;

  console.log("\nSummary");
  console.log(`  Succeeded           A: ${okA}/${runA.size}   B: ${okB}/${runB.size}`);
  console.log(
    `  Mean |Δ global|     ${meanDelta === null ? "n/a" : meanDelta.toFixed(1)} over ${globalDeltas.length} fixture(s) that succeeded in both`,
  );
  if (withExpectation > 0) {
    console.log(
      `  Expected fit band   A: ${expectedHitsA}/${withExpectation}   B: ${expectedHitsB}/${withExpectation}`,
    );
  }
  console.log(
    `\nFull output diff:\n  git diff --no-index ${display(path.join(RUNS_DIR, labelA))} ${display(path.join(RUNS_DIR, labelB))}`,
  );
}

async function readRun(label: string): Promise<Map<string, RunRecord>> {
  const dir = path.join(RUNS_DIR, label);
  if (!existsSync(dir)) fail(`No run named "${label}" in ${display(RUNS_DIR)}.`);

  const records = new Map<string, RunRecord>();
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".json") || file === "_run.json") continue;
    const record = JSON.parse(await readFile(path.join(dir, file), "utf8")) as RunRecord;
    records.set(record.fixture, record);
  }
  return records;
}

function identity(run: Map<string, RunRecord>): string {
  const record = [...run.values()].find((candidate) => candidate.model !== null);
  return record ? `${record.provider} / ${record.model}` : "provider and model unknown";
}

function statusOf(record: RunRecord): string {
  return record.result.ok
    ? `ok, global ${formatScore(record.result.feedback.overall.globalScore)}`
    : `FAIL ${record.result.error.code}`;
}

// ---------------------------------------------------------------- list

async function listCommand() {
  const fixtures = await loadFixtures();
  console.log("Fixtures");
  for (const fixture of fixtures) {
    const truncated = fixture.cvText.length > MAX_RESUME_TEXT_CHARS ? ", truncated" : "";
    console.log(
      `  ${fixture.id.padEnd(26)} ${fixture.source.padEnd(10)} expected ${String(fixture.expectedFit ?? "-").padEnd(7)} CV ${fixture.cvText.length} chars${truncated}, job ${fixture.jobDescription.length} chars`,
    );
  }

  const runs = existsSync(RUNS_DIR)
    ? (await readdir(RUNS_DIR, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
  console.log(`\nRuns in ${display(RUNS_DIR)}: ${runs.length ? runs.join(", ") : "none yet"}`);
}

// ---------------------------------------------------------------- shared

async function loadFixtures(): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];

  for (const { dir, source } of FIXTURE_SOURCES) {
    if (!existsSync(dir)) continue;
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const name of entries) {
      const base = path.join(dir, name);
      const meta = JSON.parse(
        await readFile(path.join(base, "fixture.json"), "utf8"),
      ) as FixtureMeta;
      const jobDescription = (await readFile(path.join(base, "job.txt"), "utf8")).trim();

      if (!meta.jobTitle?.trim()) fail(`${display(base)}/fixture.json needs a jobTitle.`);
      // The app rejects longer descriptions, so a fixture must not exceed them.
      if (jobDescription.length > MAX_JOB_DESCRIPTION_CHARS) {
        fail(`${display(base)}/job.txt exceeds ${MAX_JOB_DESCRIPTION_CHARS} characters.`);
      }

      fixtures.push({
        ...meta,
        jobTitle: meta.jobTitle.trim(),
        id: source === "local" ? `local-${name}` : name,
        source,
        cvText: await readFile(path.join(base, "cv.txt"), "utf8"),
        jobDescription,
      });
    }
  }
  return fixtures;
}

function parseFlags(args: string[]) {
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

function bandNote(score: number, expected: ScoreTone | null): string {
  const band = scoreTone(score);
  if (!expected) return band;
  return band === expected ? `${band} (as expected)` : `${band} (expected ${expected}) !`;
}

function formatScore(score: number): string {
  return String(Math.round(score * 10) / 10);
}

function formatDelta(delta: number): string {
  if (delta === 0) return "0";
  return `${delta > 0 ? "+" : ""}${formatScore(delta)}`;
}

function display(target: string): string {
  return path.relative(process.cwd(), target).split(path.sep).join("/");
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
