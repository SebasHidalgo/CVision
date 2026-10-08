/**
 * Evaluation harness for the resume analysis. Calls `analyzeResume`, the same
 * function analyzeResumeAction calls, over fixed fixtures and writes the
 * validated output plus its content checks, one file per fixture, so runs
 * before and after a change can be compared.
 *
 * Skips everything that isn't the model: PDF extraction, storage, DB and auth.
 * Run it through `npm run eval`, which resolves `server-only` the way Next does.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  describeCounts,
  type GuardReport,
  type Intervention,
  type InterventionCounts,
} from "@/lib/ai/analysisGuardrails";
import {
  checkAnalysis,
  countByCheck,
  countGrounding,
  mentionsTerm,
  type CheckName,
  type CheckViolation,
  type GroundingKind,
} from "@/lib/ai/analysisChecks";
import {
  analyzeResume,
  ANALYSIS_TIMEOUT_MS,
  MAX_RESUME_TEXT_CHARS,
  truncateResumeText,
} from "@/lib/ai/resumeAnalysis";
import { AppError } from "@/lib/error/errors";
import {
  MAX_JOB_DESCRIPTION_CHARS,
  deriveFitVerdict,
  describeTally,
  type RequirementKind,
  type RequirementStatus,
  type ResumeAnalysisFeedback,
} from "@/lib/schemas/resumeSchema";

const EVAL_DIR = __dirname;
const RUNS_DIR = path.join(EVAL_DIR, "runs");
const FIXTURE_SOURCES = [
  { dir: path.join(EVAL_DIR, "fixtures"), source: "synthetic" },
  { dir: path.join(EVAL_DIR, "fixtures.local"), source: "local" },
] as const;

// Provider, model and token usage are private to lib/ai/client.ts. Its
// per-call metadata log line is the only place they surface, so they are read
// from it. The line's shape is pinned by lib/ai/client.test.ts.
const AI_LOG_LINE =
  /\[CVision\]\[ai\] provider=(\S+) model=(\S+) ms=\d+ in=(\d+|\?) out=(\d+|\?)/;

/**
 * What a fixture claims about the analysis of its own CV. `in` is a dot path
 * into the feedback object: a section ("skills") or one list
 * ("skills.missingSkills"). Patterns are case-insensitive regular expressions
 * tested against the JSON of that subtree, so they see every string in it.
 *
 * A pattern assertion may name several paths joined by "+", and is then tested
 * against all of them together. That exists to exclude a sibling field: a
 * claim the analysis must make can otherwise be "satisfied" by the model
 * writing the same words somewhere it does not count, such as inside a
 * rewritten bullet it invented.
 */
type FixtureExpectations = {
  /** The section must say something matching this. */
  mustMatch?: PatternAssertion[];
  /** The section must not. */
  mustNotMatch?: PatternAssertion[];
  /** None of these items may appear in that list. */
  mustNotList?: ListAssertion[];
  /** At most this many violations of a content check. */
  maxViolations?: ViolationAssertion[];
  /** Facts about the requirements breakdown, checkable against the posting. */
  requirements?: RequirementAssertion[];
};

type PatternAssertion = { in: string; pattern: string; why?: string };
type ListAssertion = { in: string; items: string[]; why?: string };
type ViolationAssertion = { check: CheckName; max: number; why?: string };

/**
 * A claim about jobFit.requirements. Unlike a band, these are facts about the
 * posting: whether its two required qualifications are met, and whether a list
 * of alternatives was kept as one requirement, are both decidable by reading
 * the posting, which is what makes the new shape measurable.
 *
 * `matching` and `kind` select the entries; `count`/`minCount` constrain how
 * many were selected; `status` constrains every one that was.
 */
type RequirementAssertion = {
  /** Case-insensitive regex over the requirement text. */
  matching?: string;
  kind?: RequirementKind;
  /** Exactly this many requirements may match the filter. */
  count?: number;
  /** At least this many must. */
  minCount?: number;
  /** At most this many may. */
  maxCount?: number;
  /** Every matched requirement must carry one of these statuses. */
  status?: RequirementStatus[];
  why?: string;
};

type AssertionResult = {
  kind: keyof FixtureExpectations;
  in: string;
  expression: string;
  passed: boolean;
  /** What matched: the offending text, or the items that were listed. */
  found: string[];
  why?: string;
};

type FixtureMeta = {
  jobTitle: string;
  purpose?: string;
  expect?: FixtureExpectations;
};

type Fixture = FixtureMeta & {
  id: string;
  source: "synthetic" | "local";
  cvText: string;
  jobDescription: string;
  /** Present when the fixture folder holds a cv.pdf, for the --pdf spike. */
  pdf?: Uint8Array;
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
    cvChars: number;
    cvCharsSent: number;
    cvTruncated: boolean;
    jobChars: number;
    /** "pdf" means the model was given the PDF instead of the extracted text. */
    mode: "text" | "pdf";
  };
  tokens: { input: number | null; output: number | null };
  /**
   * Content checks and fixture assertions, both only when the call succeeded.
   * These are the violations as found BEFORE the production guardrail edited
   * anything, so the numbers stay comparable with every phase before it.
   */
  checks?: {
    counts: Record<CheckName, number>;
    grounding: Record<GroundingKind, number>;
    violations: CheckViolation[];
  };
  /** What the guardrail did about them, on the way to the user. */
  guardrail?: {
    counts: InterventionCounts;
    interventions: Intervention[];
  };
  assertions?: AssertionResult[];
  result:
    | { ok: true; feedback: ResumeAnalysisFeedback }
    | { ok: false; error: { name: string; code: string; message: string } };
};

const USAGE = `CVision analysis eval: run the resume analysis over fixed fixtures and
compare model output across provider, model or prompt changes.

Usage:
  npm run eval -- run <label> [--only <id,id>] [--timeout <ms>] [--force] [--pdf]
  npm run eval -- compare <labelA> <labelB>
  npm run eval -- recheck <label>
  npm run eval -- stability <label> <label> [...]
  npm run eval -- list

recheck re-runs the content checks and the fixture assertions over a stored
run and rewrites it. No model calls, nothing billed: use it after changing a
check or an assertion, so old runs stay comparable with new ones.

stability compares two or more stored runs and reports whether each posting was
split into the same required/preferred partition each time, and whether the
derived fit verdict survived. Nothing billed. The verdict is a function of that
partition, so a partition that moves between runs moves the headline with it.

--pdf is an experiment, wired into nothing in production: it hands the model
the fixture's cv.pdf instead of the text extracted from it, to compare what
each input is worth. Only fixtures holding a cv.pdf can run it.

Setup: the provider configured in .env (AI_PROVIDER, AI_MODEL and its key;
today GOOGLE_GENERATIVE_AI_API_KEY for Gemini). Every fixture is a real,
billed model call.

Workflow for a provider, model or prompt change:
  1. Before the change, capture a baseline, twice:
       npm run eval -- run baseline
       npm run eval -- run baseline-2
     Compare those two first: the model is not deterministic, and their
     difference is the noise floor any later change must be read against.
       npm run eval -- compare baseline baseline-2
  2. Make the change (provider and model live in lib/ai/client.ts and .env,
     prompts in lib/ai/prompts/), then run the same fixtures:
       npm run eval -- run after-change
  3. Compare scores side by side:
       npm run eval -- compare baseline after-change
     Full output diff:
       git diff --no-index scripts/eval/runs/baseline scripts/eval/runs/after-change

Fixtures:  scripts/eval/fixtures/<id>/        synthetic, committed
           scripts/eval/fixtures.local/<id>/  gitignored: put real CVs here
           each holds cv.txt, job.txt and fixture.json:
             { "jobTitle", "purpose"?, "expect"? }
Output:    scripts/eval/runs/<label>/<id>.json (gitignored)

Every run also records, per fixture:
  content checks  quotes that are not in the CV, items called missing that are
                  in it, and numbers in suggested bullets that are not
                  (lib/ai/analysisChecks.ts). These are counted BEFORE the
                  production guardrail edits anything, so they keep measuring
                  the model rather than what reached the user.
  guardrail       what lib/ai/analysisGuardrails.ts then did about them on the
                  way to the user: quotes dropped or normalized, invented
                  figures replaced with placeholders, bullets dropped, and
                  false-missing items recorded without correction
  assertions      the fixture's own "expect" block, if it has one:
                    "mustMatch":    [{ "in": "atsCompatibility", "pattern": "accent|encod" }]
                    "mustNotMatch": [{ "in": "educationAndCertifications", "pattern": "ongoing" }]
                    "mustNotList":  [{ "in": "skills.missingSkills", "items": ["CI/CD"] }]
                    "maxViolations":[{ "check": "fabricated-number", "max": 0 }]
                  "in" is a dot path into the feedback; patterns are
                  case-insensitive and are tested against that subtree's JSON.
                  A pattern's "in" may join several paths with "+", to assert
                  about a section while leaving one of its fields out.
                  maxViolations caps a content check for that fixture.

Each fixture is one model call, run sequentially, through analyzeResume — the
same function analyzeResumeAction calls, with its ${MAX_RESUME_TEXT_CHARS.toLocaleString("en-US")}-char CV
truncation and ${ANALYSIS_TIMEOUT_MS / 1000} s timeout.`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;

  switch (command) {
    case "run":
      return runCommand(rest);
    case "compare":
      return compareCommand(rest);
    case "recheck":
      return recheckCommand(rest);
    case "stability":
      return stabilityCommand(rest);
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
  const mode = flags.has("pdf") ? ("pdf" as const) : ("text" as const);
  const fixtures = (await loadFixtures()).filter(
    (fixture) =>
      typeof only !== "string" || only.split(",").includes(fixture.id),
  );
  if (fixtures.length === 0) fail("No fixtures matched.");

  if (mode === "pdf") {
    const without = fixtures.filter((fixture) => !fixture.pdf).map((f) => f.id);
    if (without.length) {
      fail(`--pdf needs a cv.pdf in every fixture run: ${without.join(", ")} has none.`);
    }
  }

  await mkdir(outDir, { recursive: true });
  console.log(
    `Running ${fixtures.length} fixture(s) into ${display(outDir)} (timeout ${timeoutMs} ms per call, input: ${mode === "pdf" ? "the PDF itself" : "extracted text"})\n`,
  );

  const startedAt = new Date().toISOString();
  const records: RunRecord[] = [];

  for (const fixture of fixtures) {
    const record = await runFixture(fixture, label, timeoutMs, mode);
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
  mode: "text" | "pdf",
): Promise<RunRecord> {
  // The same truncation analyzeResume applies, so the checks see exactly the
  // text the model read.
  const sent = truncateResumeText(fixture.cvText);
  const aiLog = captureAiLog();
  const startedAt = Date.now();
  let result: RunRecord["result"];
  let guard: GuardReport | undefined;

  try {
    const analysis = await analyzeResume({
      jobTitle: fixture.jobTitle,
      jobDescription: fixture.jobDescription,
      resumeText: fixture.cvText,
      timeoutMs,
      // The spike: hand the model the PDF and let it read the document.
      ...(mode === "pdf" ? { pdf: fixture.pdf } : {}),
    });
    guard = analysis.guard;
    result = { ok: true, feedback: analysis.feedback };
  } catch (error) {
    result = { ok: false, error: describeError(error) };
  } finally {
    aiLog.restore();
  }

  /*
   * The guardrail already ran the checks against the text the model received,
   * before it edited anything, so its list is what the model actually produced
   * - re-running them on the cleaned output here would read near zero and hide
   * exactly what this harness exists to see. The fallback keeps the --pdf
   * spike measurable, where the guardrail has no CV text to work from.
   */
  const violations = result.ok
    ? (guard?.violations ?? checkAnalysis(sent.text, result.feedback))
    : undefined;

  return {
    fixture: fixture.id,
    source: fixture.source,
    label,
    provider: aiLog.meta.provider,
    model: aiLog.meta.model,
    tokens: { input: aiLog.meta.inputTokens, output: aiLog.meta.outputTokens },
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    checks: violations && {
      counts: countByCheck(violations),
      grounding: countGrounding(violations),
      violations,
    },
    guardrail: guard && {
      counts: guard.counts,
      interventions: guard.interventions,
    },
    assertions: result.ok
      ? evaluateAssertions(result.feedback, fixture.expect, violations ?? [])
      : undefined,
    input: {
      jobTitle: fixture.jobTitle,
      cvChars: fixture.cvText.length,
      cvCharsSent: sent.charsSent,
      cvTruncated: sent.truncated,
      jobChars: fixture.jobDescription.length,
      mode,
    },
    result,
  };
}

// ------------------------------------------------- fixture assertions

/** The subtree at a dot path, or undefined when the path does not resolve. */
function pick(feedback: ResumeAnalysisFeedback, dotPath: string): unknown {
  return dotPath
    .split(".")
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown> | undefined)?.[key],
      feedback,
    );
}

/** Every string under a subtree, as one searchable blob. */
function textOf(section: unknown): string {
  return JSON.stringify(section ?? null);
}

function evaluateAssertions(
  feedback: ResumeAnalysisFeedback,
  expectations: FixtureExpectations | undefined,
  violations: CheckViolation[],
): AssertionResult[] {
  if (!expectations) return [];
  const results: AssertionResult[] = [];

  for (const assertion of expectations.maxViolations ?? []) {
    const hits = violations.filter((v) => v.check === assertion.check);
    results.push({
      kind: "maxViolations",
      in: assertion.check,
      expression: `at most ${assertion.max}`,
      passed: hits.length <= assertion.max,
      found: hits.map((hit) => `${hit.path}: ${hit.value}`),
      why: assertion.why,
    });
  }

  for (const kind of ["mustMatch", "mustNotMatch"] as const) {
    for (const assertion of expectations[kind] ?? []) {
      const sections = assertion.in
        .split("+")
        .map((path) => pick(feedback, path.trim()));
      const resolved = sections.every((section) => section !== undefined);
      const matched = new RegExp(assertion.pattern, "i").exec(
        sections.map(textOf).join("\n"),
      );
      const hit = matched !== null;

      results.push({
        kind,
        in: assertion.in,
        expression: assertion.pattern,
        // A path that resolves to nothing fails either way: the fixture is
        // asserting about something that is not there.
        passed: !resolved ? false : kind === "mustMatch" ? hit : !hit,
        found: !resolved ? ["path not found"] : hit ? [matched[0]] : [],
        why: assertion.why,
      });
    }
  }

  for (const assertion of expectations.requirements ?? []) {
    const matching = assertion.matching
      ? new RegExp(assertion.matching, "i")
      : null;
    const selected = feedback.jobFit.requirements.filter(
      (requirement) =>
        (!matching || matching.test(requirement.requirement)) &&
        (!assertion.kind || requirement.kind === assertion.kind),
    );

    const wrongStatus = assertion.status
      ? selected.filter(
          (requirement) => !assertion.status?.includes(requirement.status),
        )
      : [];

    const countOk =
      (assertion.count === undefined || selected.length === assertion.count) &&
      (assertion.minCount === undefined || selected.length >= assertion.minCount) &&
      (assertion.maxCount === undefined || selected.length <= assertion.maxCount);

    const wants = [
      assertion.kind ? `kind ${assertion.kind}` : "",
      assertion.matching ? `matching /${assertion.matching}/` : "",
      assertion.count !== undefined ? `exactly ${assertion.count}` : "",
      assertion.minCount !== undefined ? `at least ${assertion.minCount}` : "",
      assertion.maxCount !== undefined ? `at most ${assertion.maxCount}` : "",
      assertion.status ? `status ${assertion.status.join("|")}` : "",
    ].filter(Boolean);

    results.push({
      kind: "requirements",
      in: "jobFit.requirements",
      expression: wants.join(", "),
      passed: countOk && wrongStatus.length === 0,
      // Says which way it failed: the wrong number, or the wrong status.
      found: [
        `${selected.length} matched`,
        ...wrongStatus.map(
          (requirement) =>
            `${requirement.status}: ${requirement.requirement.slice(0, 80)}`,
        ),
      ],
      why: assertion.why,
    });
  }

  for (const assertion of expectations.mustNotList ?? []) {
    const list = pick(feedback, assertion.in);
    const entries = Array.isArray(list) ? list.map(String) : null;
    const found = entries
      ? assertion.items.filter((item) =>
          entries.some((entry) => mentionsTerm(entry, item)),
        )
      : ["list not found"];

    results.push({
      kind: "mustNotList",
      in: assertion.in,
      expression: assertion.items.join(", "),
      passed: entries !== null && found.length === 0,
      found,
      why: assertion.why,
    });
  }

  return results;
}

/** The derived verdict and the counts it came from. */
function tallyNote(feedback: ResumeAnalysisFeedback): string {
  const fit = deriveFitVerdict(feedback);
  return `${fit.tone} - ${describeTally(fit.tally)}`;
}

function assertionNote(assertions: AssertionResult[] | undefined): string {
  if (!assertions?.length) return "";
  const failed = assertions.filter((assertion) => !assertion.passed).length;
  return failed === 0
    ? `${assertions.length}/${assertions.length} assertions`
    : `${assertions.length - failed}/${assertions.length} assertions, ${failed} FAILED`;
}

/**
 * What the production guardrail did on the way to the user. Printed next to
 * the raw check counts on purpose: seeing "quotes 2 ... guardrail dropped 2"
 * is the whole point of keeping both numbers.
 */
function guardrailNote(guardrail: RunRecord["guardrail"]): string {
  if (!guardrail) return "";
  const note = describeCounts(guardrail.counts);
  return note ? `guardrail: ${note}` : "";
}

function checkNote(checks: RunRecord["checks"]): string {
  if (!checks) return "";
  const { counts } = checks;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return "checks clean";

  // Runs recorded before the split still have their violations to count from.
  const grounding = checks.grounding ?? countGrounding(checks.violations);
  const quotes = counts["evidence-grounding"];
  const detail = quotes
    ? ` (${grounding["not-found"]} not found, ${grounding["case-or-punctuation"]} case, ${grounding.altered} altered)`
    : "";

  return `quotes ${quotes}${detail}, false-missing ${counts["false-missing"]}, numbers ${counts["fabricated-number"]}`;
}

function captureAiLog() {
  const original = console.info;
  const meta: {
    provider: string | null;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
  } = { provider: null, model: null, inputTokens: null, outputTokens: null };

  const count = (value: string) => (value === "?" ? null : Number(value));

  console.info = (...args: unknown[]) => {
    const match = AI_LOG_LINE.exec(args.map(String).join(" "));
    if (!match) return original(...args);
    meta.provider = match[1];
    meta.model = match[2];
    meta.inputTokens = count(match[3]);
    meta.outputTokens = count(match[4]);
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

  const feedback = record.result.feedback;
  const fit = deriveFitVerdict(feedback);
  // The verdict is derived, so it is printed with the counts behind it; the
  // only model-chosen number left is quality.
  const head = `  ${id} ok    fit ${fit.tone.padEnd(6)} quality ${formatScore(feedback.overall.qualityScore).padStart(3)}  ${seconds}`;
  const notes = [
    record.input.mode === "pdf" ? "input: PDF" : "",
    record.tokens.input === null ? "" : `${record.tokens.input} in / ${record.tokens.output} out tokens`,
    record.input.cvTruncated
      ? `TRUNCATED ${record.input.cvCharsSent}/${record.input.cvChars} chars`
      : "",
    describeTally(fit.tally),
    checkNote(record.checks),
    guardrailNote(record.guardrail),
    assertionNote(record.assertions),
  ]
    .filter(Boolean)
    .join("   ");

  return notes ? `${head}\n${" ".repeat(10)}${notes}` : head;
}

// ---------------------------------------------------------------- recheck

/**
 * Re-scores a stored run against today's checks and assertions. The model
 * output is kept as it was; only the verdicts about it are recomputed.
 */
async function recheckCommand(args: string[]) {
  const [label] = parseFlags(args).positional;
  if (!label) fail(`recheck needs a label.\n\n${USAGE}`);

  const dir = path.join(RUNS_DIR, label);
  if (!existsSync(dir)) fail(`No run named "${label}" in ${display(RUNS_DIR)}.`);

  const fixtures = new Map((await loadFixtures()).map((f) => [f.id, f]));

  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith(".json") || file === "_run.json") continue;

    const target = path.join(dir, file);
    const record = JSON.parse(await readFile(target, "utf8")) as RunRecord;
    if (!record.result.ok) continue;

    const fixture = fixtures.get(record.fixture);
    if (!fixture) {
      console.log(`  ${record.fixture.padEnd(26)} skipped: no such fixture any more`);
      continue;
    }

    // What that run sent, not what today's limit would send: a record made
    // under the old 20,000-char limit must still be judged against the text
    // its model actually read.
    const violations = checkAnalysis(
      fixture.cvText.slice(0, record.input.cvCharsSent),
      record.result.feedback,
    );
    record.checks = {
      counts: countByCheck(violations),
      grounding: countGrounding(violations),
      violations,
    };
    record.assertions = evaluateAssertions(
      record.result.feedback,
      fixture.expect,
      violations,
    );

    await writeJson(target, record);
    console.log(
      `  ${record.fixture.padEnd(26)} ${[checkNote(record.checks), assertionNote(record.assertions)].filter(Boolean).join("   ")}`,
    );
  }
}

// ---------------------------------------------------------------- compare

const SCORE_ROWS: Array<[string, (feedback: ResumeAnalysisFeedback) => number]> = [
  ["Quality", (f) => f.overall.qualityScore],
  ["Experience", (f) => f.experienceAndImpact.score],
  ["Skills", (f) => f.skills.score],
  ["Education", (f) => f.educationAndCertifications.score],
];

async function compareCommand(args: string[]) {
  const [labelA, labelB] = parseFlags(args).positional;
  if (!labelA || !labelB) fail(`compare needs two labels.\n\n${USAGE}`);

  const runA = await readRun(labelA);
  const runB = await readRun(labelB);

  console.log(`A = ${labelA}  (${identity(runA)})`);
  console.log(`B = ${labelB}  (${identity(runB)})`);

  const ids = [...new Set([...runA.keys(), ...runB.keys()])].sort();
  const qualityDeltas: number[] = [];
  const checkTotals = { A: 0, B: 0 };
  const assertionTotals = {
    A: { passed: 0, total: 0 },
    B: { passed: 0, total: 0 },
  };

  for (const id of ids) {
    const a = runA.get(id);
    const b = runB.get(id);
    console.log(`\n${id}`);

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
    console.log(`  Fit         A: ${tallyNote(fa)}`);
    console.log(`              B: ${tallyNote(fb)}`);
    console.log(
      `  Time        A: ${(a.durationMs / 1000).toFixed(1)} s   B: ${(b.durationMs / 1000).toFixed(1)} s`,
    );

    // What the next steps are judged on: the content of the analysis, not the
    // score it carries.
    console.log(`  Checks      A: ${checkNote(a.checks) || "n/a"}`);
    console.log(`              B: ${checkNote(b.checks) || "n/a"}`);
    console.log(`  Guardrail   A: ${guardrailNote(a.guardrail) || "nothing fired"}`);
    console.log(`              B: ${guardrailNote(b.guardrail) || "nothing fired"}`);
    for (const [side, record] of [
      ["A", a],
      ["B", b],
    ] as const) {
      if (record.input.cvTruncated) {
        console.log(
          `    ${side} ! CV truncated: ${record.input.cvCharsSent}/${record.input.cvChars} chars sent`,
        );
      }
    }
    for (const [side, record] of [
      ["A", a],
      ["B", b],
    ] as const) {
      for (const violation of record.checks?.violations ?? []) {
        console.log(
          `    ${side} ! ${violation.check} ${violation.path}: ${truncate(violation.value)}${violation.note ? ` (${violation.note})` : ""}`,
        );
      }
      checkTotals[side] += (record.checks?.violations ?? []).length;
    }

    if (a.assertions?.length || b.assertions?.length) {
      console.log(`  Assertions  A: ${assertionNote(a.assertions) || "none"}`);
      console.log(`              B: ${assertionNote(b.assertions) || "none"}`);
      for (const [side, record] of [
        ["A", a],
        ["B", b],
      ] as const) {
        for (const assertion of record.assertions ?? []) {
          assertionTotals[side].total += 1;
          if (assertion.passed) {
            assertionTotals[side].passed += 1;
            continue;
          }
          console.log(
            `    ${side} ! ${assertion.kind} ${assertion.in}: ${truncate(assertion.expression)}${assertion.found.length ? ` -> ${truncate(assertion.found.join(", "))}` : ""}`,
          );
        }
      }
    }

    qualityDeltas.push(
      Math.abs(fb.overall.qualityScore - fa.overall.qualityScore),
    );
  }

  const okA = [...runA.values()].filter((record) => record.result.ok).length;
  const okB = [...runB.values()].filter((record) => record.result.ok).length;
  const meanDelta = qualityDeltas.length
    ? qualityDeltas.reduce((sum, delta) => sum + delta, 0) / qualityDeltas.length
    : null;

  console.log("\nSummary");
  console.log(`  Succeeded           A: ${okA}/${runA.size}   B: ${okB}/${runB.size}`);
  console.log(
    `  Mean |Δ quality|    ${meanDelta === null ? "n/a" : meanDelta.toFixed(1)} over ${qualityDeltas.length} fixture(s) that succeeded in both`,
  );
  console.log(
    `  Check violations    A: ${checkTotals.A}   B: ${checkTotals.B}   (lower is better)`,
  );
  if (assertionTotals.A.total || assertionTotals.B.total) {
    console.log(
      `  Assertions passed   A: ${assertionTotals.A.passed}/${assertionTotals.A.total}   B: ${assertionTotals.B.passed}/${assertionTotals.B.total}`,
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
    ? `ok, quality ${formatScore(record.result.feedback.overall.qualityScore)}`
    : `FAIL ${record.result.error.code}`;
}

// ---------------------------------------------------------------- list

// ------------------------------------------------------------- stability

/**
 * Whether the required/preferred partition holds still across runs.
 *
 * This matters more than it used to. The fit verdict is now derived from the
 * partition, so a posting read as 6 required + 1 preferred in one run and
 * 11 required + 0 preferred in the next does not just look untidy - it hands
 * the user a different headline for the same resume. Observed once on
 * es-cv-en-job; this makes the rate visible instead of anecdotal.
 *
 * Reports two things, because they fail independently: whether the shape of
 * the partition is identical, and whether the derived verdict survives it. A
 * partition can wobble without changing the verdict, and that is a much
 * cheaper problem.
 */
async function stabilityCommand(args: string[]) {
  const labels = parseFlags(args).positional;
  if (labels.length < 2) {
    fail(`stability needs at least two run labels.\n\n${USAGE}`);
  }

  const runs = await Promise.all(labels.map((label) => readRun(label)));
  const ids = [...new Set(runs.flatMap((run) => [...run.keys()]))].sort();

  console.log(`Partition stability across ${labels.length} runs: ${labels.join(", ")}\n`);

  let comparable = 0;
  let shapeStable = 0;
  let verdictStable = 0;

  for (const id of ids) {
    const records = runs.map((run) => run.get(id)).filter((r) => r?.result.ok);
    if (records.length < 2) {
      console.log(`  ${id.padEnd(26)} skipped (succeeded in fewer than two runs)`);
      continue;
    }

    comparable += 1;
    const seen = records.map((record) => {
      // `record.result.ok` is already filtered above.
      const feedback = (record!.result as { feedback: ResumeAnalysisFeedback })
        .feedback;
      const fit = deriveFitVerdict(feedback);
      return {
        shape: `${fit.tally.required.total}R/${fit.tally.preferred.total}P`,
        verdict: fit.tone,
        detail: describeTally(fit.tally),
      };
    });

    const shapes = new Set(seen.map((s) => s.shape));
    const verdicts = new Set(seen.map((s) => s.verdict));
    if (shapes.size === 1) shapeStable += 1;
    if (verdicts.size === 1) verdictStable += 1;

    const flag =
      verdicts.size > 1 ? "VERDICT MOVED" : shapes.size > 1 ? "shape moved" : "stable";
    console.log(
      `  ${id.padEnd(26)} ${flag.padEnd(14)} ${seen.map((s) => `${s.shape} ${s.verdict}`).join("  |  ")}`,
    );
    if (shapes.size > 1) {
      for (const [i, s] of seen.entries()) {
        console.log(`      ${labels[i].padEnd(12)} ${s.detail}`);
      }
    }
  }

  console.log(
    `\n  partition shape stable: ${shapeStable}/${comparable} fixtures` +
      `\n  derived verdict stable: ${verdictStable}/${comparable} fixtures`,
  );
}

// ---------------------------------------------------------------- list

async function listCommand() {
  const fixtures = await loadFixtures();
  console.log("Fixtures");
  for (const fixture of fixtures) {
    const truncated = fixture.cvText.length > MAX_RESUME_TEXT_CHARS ? ", truncated" : "";
    const assertions = Object.values(fixture.expect ?? {}).reduce(
      (sum, group) => sum + group.length,
      0,
    );
    console.log(
      `  ${fixture.id.padEnd(26)} ${fixture.source.padEnd(10)} CV ${fixture.cvText.length} chars${truncated}, job ${fixture.jobDescription.length} chars, ${assertions} assertion(s)`,
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

      // A typo in a pattern would otherwise surface as a passing assertion.
      for (const assertion of [
        ...(meta.expect?.mustMatch ?? []),
        ...(meta.expect?.mustNotMatch ?? []),
      ]) {
        try {
          new RegExp(assertion.pattern, "i");
        } catch (error) {
          fail(
            `${display(base)}/fixture.json: bad pattern ${JSON.stringify(assertion.pattern)} (${(error as Error).message})`,
          );
        }
      }
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
        // Optional: only fixtures built from a real PDF can run the spike.
        pdf: existsSync(path.join(base, "cv.pdf"))
          ? new Uint8Array(await readFile(path.join(base, "cv.pdf")))
          : undefined,
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

function truncate(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
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
