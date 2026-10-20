/**
 * The interview feedback mode of the evaluation harness. Scores synthetic
 * transcripts through `scoreTranscript`, the same function the generator
 * calls, and records the validated feedback, the content checks (quotes
 * against the candidate's turns, anchors, gap coverage, invented numbers and
 * terms), what the guardrail did, and the fixture's own assertions.
 *
 * Shares the engine fingerprint, the comparability gate and the canary with
 * the analysis mode through ./shared.ts.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  FEEDBACK_TIMEOUT_MS,
  feedbackAllowedText,
  scoreTranscript,
  type FeedbackContext,
} from "@/lib/ai/interviewFeedback";
import {
  candidateText,
  checkInterviewFeedback,
  countInterviewChecks,
  describeInterviewCounts,
  type InterviewCheckName,
  type InterviewCheckViolation,
  type InterviewGuardReport,
  type InterviewIntervention,
  type InterviewInterventionCounts,
} from "@/lib/ai/interviewGuardrails";
import { computeInterviewStats } from "@/lib/ai/interviewStats";
import { requirementGaps } from "@/lib/ai/prompts/interviewer.agent";
import {
  FEEDBACK_CATEGORIES,
  GAP_OUTCOMES,
  type GapOutcome,
  type InterviewFeedbackReport,
} from "@/lib/ai/schemas";
import { countGrounding, type GroundingKind } from "@/lib/ai/analysisChecks";
import { transcriptTurnSchema, type TranscriptTurn } from "@/lib/elevenlabs/postCall";
import { interviewContextSchema } from "@/lib/schemas/interviewSchema";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import {
  captureAiLog,
  describeEngine,
  describeError,
  display,
  engineFrom,
  EVAL_DIR,
  fail,
  formatDelta,
  formatScore,
  identity,
  parseFlags,
  readApiModelVersion,
  readRunRecords,
  requireComparable,
  RUNS_DIR,
  truncate,
  writeJson,
  type BaseRunRecord,
} from "./shared";

const FIXTURES_DIR = path.join(EVAL_DIR, "fixtures-interview");

type PatternAssertion = { in: string; pattern: string; why?: string };
type ViolationAssertion = { check: InterviewCheckName; max: number; why?: string };
/** The rows for gaps matching the pattern must carry one of these outcomes. */
type GapOutcomeAssertion = { matching: string; outcome: GapOutcome[]; why?: string };
/** A category score, or the total, inside a band. */
type ScoreAssertion = {
  category: (typeof FEEDBACK_CATEGORIES)[number] | "total";
  min?: number;
  max?: number;
  why?: string;
};

type InterviewExpectations = {
  mustMatch?: PatternAssertion[];
  mustNotMatch?: PatternAssertion[];
  maxViolations?: ViolationAssertion[];
  gapOutcomes?: GapOutcomeAssertion[];
  scores?: ScoreAssertion[];
};

type AssertionResult = {
  kind: keyof InterviewExpectations | "gapRows";
  in: string;
  expression: string;
  passed: boolean;
  found: string[];
  why?: string;
};

const fixtureMetaSchema = z.object({
  purpose: z.string().optional(),
  candidateName: z.string().min(1),
  language: z.enum(["en", "es"]).optional(),
  durationSeconds: z.number().nullable().optional(),
  /** The agent's limit the interview ran under; the full twelve minutes when absent. */
  plannedSeconds: z.number().positive().optional(),
  context: z.object({
    role: z.string().min(1),
    company: z.string().min(1),
    jobDescription: z.string().min(1),
    analysisSummary: z.string(),
    requirements: interviewContextSchema.shape.jobFit.shape.requirements,
  }),
  expect: z.custom<InterviewExpectations>().optional(),
});

type Fixture = z.infer<typeof fixtureMetaSchema> & {
  id: string;
  turns: TranscriptTurn[];
  context: FeedbackContext;
};

type InterviewRunRecord = BaseRunRecord & {
  kind: "interview";
  input: { turns: number; candidateTurns: number; jobChars: number; gaps: number };
  checks?: {
    counts: Record<InterviewCheckName, number>;
    grounding: Record<GroundingKind, number>;
    violations: InterviewCheckViolation[];
  };
  guardrail?: { counts: InterviewInterventionCounts; interventions: InterviewIntervention[] };
  assertions?: AssertionResult[];
  result:
    | { ok: true; feedback: InterviewFeedbackReport }
    | { ok: false; error: { name: string; code: string; message: string } };
};

const USAGE = `CVision interview feedback eval: score synthetic transcripts over fixed
fixtures and compare the feedback across prompt, schema or model changes.

Usage:
  npm run eval -- interview run <label> [--only <id,id>] [--timeout <ms>] [--force]
  npm run eval -- interview compare <labelA> <labelB> [--force]
  npm run eval -- interview recheck <label>
  npm run eval -- interview canary <reference-label> [--only <id>]
  npm run eval -- interview list

Fixtures:  scripts/eval/fixtures-interview/<id>/
             fixture.json   { candidateName, language?, durationSeconds?, plannedSeconds?,
                              purpose?, context: { role, company, jobDescription,
                                         analysisSummary, requirements[] },
                              expect? }
             transcript.json  [{ role: "agent"|"user", message, time_in_call_secs }]
Output:    scripts/eval/runs/<label>/<id>.json (gitignored), beside analysis runs

Every run records, per fixture:
  content checks  quotes that are not verbatim spans of the candidate's turns,
                  anchors that point at nothing, gap rows that do not match the
                  gaps one to one, and numbers or technology-shaped terms in the
                  prose that neither speaker nor the posting said
                  (lib/ai/interviewGuardrails.ts), counted BEFORE the guardrail
                  edits anything
  guardrail       what the guardrail did: quotes dropped or normalized, items
                  with a bad anchor dropped, the rest recorded
  assertions      the fixture's "expect" block:
                    "mustMatch" / "mustNotMatch": [{ "in": "finalAssessment", "pattern": "short" }]
                    "maxViolations": [{ "check": "evidence-grounding", "max": 0 }]
                    "gapOutcomes":   [{ "matching": "kubernetes", "outcome": ["dodged","partially","not_raised"] }]
                    "scores":        [{ "category": "total", "max": 85 }]
                  plus, always, that gapFollowThrough has one row per gap.

Same rules as the analysis mode: a change needs its control captured in the
same session, compare refuses runs with a different engine or sampling or more
than 6 h apart, and canary byte-compares one fixture against a reference run.
Each fixture is one billed model call through scoreTranscript, the function
generateInterviewFeedback calls, with its ${FEEDBACK_TIMEOUT_MS / 1000} s timeout.`;

export async function interviewMain(argv: string[]) {
  const [command, ...rest] = argv;
  switch (command) {
    case "run":
      return runCommand(rest);
    case "compare":
      return compareCommand(rest);
    case "recheck":
      return recheckCommand(rest);
    case "canary":
      return canaryCommand(rest);
    case "list":
      return listCommand();
    case undefined:
    case "help":
      console.log(USAGE);
      return;
    default:
      fail(`Unknown interview command "${command}".\n\n${USAGE}`);
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
      fail(`${display(outDir)} already exists. Pick another label, or pass --force to overwrite it.`);
    }
    await rm(outDir, { recursive: true });
  }

  const timeoutMs = flags.has("timeout") ? Number(flags.get("timeout")) : FEEDBACK_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    fail("--timeout must be a positive integer number of milliseconds.");
  }

  const only = flags.get("only");
  const fixtures = (await loadFixtures()).filter(
    (fixture) => typeof only !== "string" || only.split(",").includes(fixture.id),
  );
  if (fixtures.length === 0) fail("No fixtures matched.");

  await mkdir(outDir, { recursive: true });
  console.log(
    `Scoring ${fixtures.length} transcript(s) into ${display(outDir)} (timeout ${timeoutMs} ms per call)\n`,
  );

  const startedAt = new Date().toISOString();
  const records: InterviewRunRecord[] = [];
  let apiModelVersion: string | null = null;
  let versionLookedUp = false;

  for (const fixture of fixtures) {
    const record = await runFixture(fixture, label, timeoutMs);
    if (!versionLookedUp && record.model) {
      apiModelVersion = await readApiModelVersion(record.model);
      versionLookedUp = true;
    }
    if (record.engine) record.engine.apiModelVersion = apiModelVersion;
    await writeJson(path.join(outDir, `${fixture.id}.json`), record);
    console.log(formatProgress(record));
    records.push(record);
  }

  const identified = records.find((record) => record.model !== null);
  await writeJson(path.join(outDir, "_run.json"), {
    label,
    kind: "interview",
    startedAt,
    finishedAt: new Date().toISOString(),
    provider: identified?.provider ?? null,
    model: identified?.model ?? null,
    engine: identified?.engine ?? null,
    timeoutMs,
    node: process.version,
    fixtures: records.map(({ fixture, result, durationMs }) => ({ fixture, ok: result.ok, durationMs })),
  });

  const okCount = records.filter((record) => record.result.ok).length;
  console.log(`\n${okCount}/${records.length} succeeded. ${describeEngine(identified?.engine)}`);
  console.log(
    `A change needs its control beside it: capture both today, then\n  npm run eval -- interview compare <control> ${label}`,
  );
}

async function runFixture(fixture: Fixture, label: string, timeoutMs: number): Promise<InterviewRunRecord> {
  const aiLog = captureAiLog();
  const startedAt = Date.now();
  let result: InterviewRunRecord["result"];
  let guard: InterviewGuardReport | undefined;

  try {
    const scored = await scoreTranscript({
      context: fixture.context,
      turns: fixture.turns,
      durationSeconds: fixture.durationSeconds ?? null,
      plannedSeconds: fixture.plannedSeconds,
      timeoutMs,
    });
    guard = scored.guard;
    result = { ok: true, feedback: scored.report };
  } catch (error) {
    result = { ok: false, error: describeError(error) };
  } finally {
    aiLog.restore();
  }

  // The guardrail ran the checks on the model's answer before editing it;
  // those violations are the measurement, not what reached the file.
  const violations = result.ok ? guard?.violations : undefined;

  return {
    kind: "interview",
    fixture: fixture.id,
    source: "synthetic",
    label,
    provider: aiLog.meta.provider,
    model: aiLog.meta.model,
    engine: engineFrom(aiLog.meta),
    tokens: { input: aiLog.meta.inputTokens, output: aiLog.meta.outputTokens },
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    input: {
      turns: fixture.turns.length,
      candidateTurns: fixture.turns.filter((turn) => turn.role === "user").length,
      jobChars: fixture.context.jobDescription.length,
      gaps: fixture.context.gaps.length,
    },
    checks: violations && {
      counts: countInterviewChecks(violations),
      grounding: countGrounding(violations.map((v) => ({ ...v, check: "evidence-grounding" as const }))),
      violations,
    },
    guardrail: guard && { counts: guard.counts, interventions: guard.interventions },
    assertions: result.ok ? evaluateAssertions(fixture, result.feedback, violations ?? []) : undefined,
    result,
  };
}

// ------------------------------------------------------- assertions

function pick(feedback: InterviewFeedbackReport, dotPath: string): unknown {
  return dotPath
    .split(".")
    .reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], feedback);
}

function evaluateAssertions(
  fixture: Fixture,
  feedback: InterviewFeedbackReport,
  violations: InterviewCheckViolation[],
): AssertionResult[] {
  const expectations = fixture.expect ?? {};
  const results: AssertionResult[] = [];
  const gaps = fixture.context.gaps;

  // Always: one row per gap. The structural promise of the shape.
  results.push({
    kind: "gapRows",
    in: "gapFollowThrough",
    expression: `exactly ${gaps.length} row(s), one per gap`,
    passed:
      feedback.gapFollowThrough.length === gaps.length &&
      !violations.some((v) => v.check === "gap-coverage"),
    found: [
      `${feedback.gapFollowThrough.length} row(s)`,
      ...violations.filter((v) => v.check === "gap-coverage").map((v) => `${v.note}: ${truncate(v.value, 60)}`),
    ],
  });

  for (const assertion of expectations.maxViolations ?? []) {
    const hits = violations.filter((v) => v.check === assertion.check);
    results.push({
      kind: "maxViolations",
      in: assertion.check,
      expression: `at most ${assertion.max}`,
      passed: hits.length <= assertion.max,
      found: hits.map((hit) => `${hit.path}: ${truncate(hit.value, 60)}`),
      why: assertion.why,
    });
  }

  for (const kind of ["mustMatch", "mustNotMatch"] as const) {
    for (const assertion of expectations[kind] ?? []) {
      const sections = assertion.in.split("+").map((p) => pick(feedback, p.trim()));
      const resolved = sections.every((section) => section !== undefined);
      const matched = new RegExp(assertion.pattern, "i").exec(sections.map((s) => JSON.stringify(s ?? null)).join("\n"));
      const hit = matched !== null;
      results.push({
        kind,
        in: assertion.in,
        expression: assertion.pattern,
        passed: !resolved ? false : kind === "mustMatch" ? hit : !hit,
        found: !resolved ? ["path not found"] : hit ? [matched[0]] : [],
        why: assertion.why,
      });
    }
  }

  for (const assertion of expectations.gapOutcomes ?? []) {
    const matching = new RegExp(assertion.matching, "i");
    const rows = feedback.gapFollowThrough.filter((row) => matching.test(row.requirement));
    const wrong = rows.filter((row) => !assertion.outcome.includes(row.outcome));
    results.push({
      kind: "gapOutcomes",
      in: "gapFollowThrough",
      expression: `/${assertion.matching}/ -> ${assertion.outcome.join("|")}`,
      passed: rows.length > 0 && wrong.length === 0,
      found: rows.length === 0 ? ["no row matched"] : rows.map((row) => `${row.outcome}: ${truncate(row.requirement, 50)}`),
      why: assertion.why,
    });
  }

  for (const assertion of expectations.scores ?? []) {
    const score =
      assertion.category === "total"
        ? feedback.totalScore
        : (feedback.categoryScores.find((c) => c.name === assertion.category)?.score ?? NaN);
    const passed =
      Number.isFinite(score) &&
      (assertion.min === undefined || score >= assertion.min) &&
      (assertion.max === undefined || score <= assertion.max);
    results.push({
      kind: "scores",
      in: assertion.category,
      expression: [assertion.min !== undefined ? `>= ${assertion.min}` : "", assertion.max !== undefined ? `<= ${assertion.max}` : ""]
        .filter(Boolean)
        .join(" and "),
      passed,
      found: [String(score)],
      why: assertion.why,
    });
  }

  return results;
}

// ------------------------------------------------------------ output

function outcomeTally(feedback: InterviewFeedbackReport): string {
  const counts = Object.fromEntries(GAP_OUTCOMES.map((o) => [o, 0])) as Record<GapOutcome, number>;
  for (const row of feedback.gapFollowThrough) counts[row.outcome] += 1;
  return GAP_OUTCOMES.filter((o) => counts[o] > 0)
    .map((o) => `${o} ${counts[o]}`)
    .join(", ") || "no gaps";
}

function checkNote(checks: InterviewRunRecord["checks"]): string {
  if (!checks) return "";
  const { counts } = checks;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return "checks clean";
  const quotes = counts["evidence-grounding"];
  const detail = quotes
    ? ` (${checks.grounding["not-found"]} not found, ${checks.grounding["case-or-punctuation"]} case, ${checks.grounding.altered} altered)`
    : "";
  return `quotes ${quotes}${detail}, anchors ${counts["anchor-invalid"]}, gaps ${counts["gap-coverage"]}, numbers ${counts["fabricated-number"]}, terms ${counts["fabricated-term"]}`;
}

function guardrailNote(guardrail: InterviewRunRecord["guardrail"]): string {
  if (!guardrail) return "";
  const note = describeInterviewCounts(guardrail.counts);
  return note ? `guardrail: ${note}` : "";
}

function assertionNote(assertions: AssertionResult[] | undefined): string {
  if (!assertions?.length) return "";
  const failed = assertions.filter((assertion) => !assertion.passed).length;
  return failed === 0
    ? `${assertions.length}/${assertions.length} assertions`
    : `${assertions.length - failed}/${assertions.length} assertions, ${failed} FAILED`;
}

function formatProgress(record: InterviewRunRecord): string {
  const seconds = `${(record.durationMs / 1000).toFixed(1)} s`;
  const id = record.fixture.padEnd(26);
  if (!record.result.ok) {
    return `  ${id} FAIL  ${record.result.error.code.padEnd(28)} ${seconds}`;
  }
  const feedback = record.result.feedback;
  const head = `  ${id} ok    total ${String(feedback.totalScore).padStart(3)}  gaps: ${outcomeTally(feedback)}  ${seconds}`;
  const notes = [
    record.tokens.input === null ? "" : `${record.tokens.input} in / ${record.tokens.output} out tokens`,
    feedback.interviewStats.short ? "SHORT" : "",
    checkNote(record.checks),
    guardrailNote(record.guardrail),
    assertionNote(record.assertions),
  ]
    .filter(Boolean)
    .join("   ");
  const failed = (record.assertions ?? []).filter((a) => !a.passed);
  const detail = failed
    .map((a) => `${" ".repeat(10)}! ${a.kind} ${a.in}: ${truncate(a.expression, 60)}${a.found.length ? ` -> ${truncate(a.found.join(", "), 80)}` : ""}`)
    .join("\n");
  return [notes ? `${head}\n${" ".repeat(10)}${notes}` : head, detail].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- recheck

async function recheckCommand(args: string[]) {
  const [label] = parseFlags(args).positional;
  if (!label) fail(`recheck needs a label.\n\n${USAGE}`);
  const dir = path.join(RUNS_DIR, label);
  if (!existsSync(dir)) fail(`No run named "${label}" in ${display(RUNS_DIR)}.`);

  const fixtures = new Map((await loadFixtures()).map((f) => [f.id, f]));
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith(".json") || file === "_run.json") continue;
    const target = path.join(dir, file);
    const record = JSON.parse(await readFile(target, "utf8")) as InterviewRunRecord;
    if (record.kind !== "interview" || !record.result.ok) continue;
    const fixture = fixtures.get(record.fixture);
    if (!fixture) {
      console.log(`  ${record.fixture.padEnd(26)} skipped: no such fixture any more`);
      continue;
    }
    const violations = checkInterviewFeedback({
      candidateText: candidateText(fixture.turns),
      allowedText: allowedTextFor(fixture),
      gaps: fixture.context.gaps,
      feedback: record.result.feedback,
    });
    record.checks = {
      counts: countInterviewChecks(violations),
      grounding: countGrounding(violations.map((v) => ({ ...v, check: "evidence-grounding" as const }))),
      violations,
    };
    record.assertions = evaluateAssertions(fixture, record.result.feedback, violations);
    await writeJson(target, record);
    console.log(`  ${record.fixture.padEnd(26)} ${[checkNote(record.checks), assertionNote(record.assertions)].filter(Boolean).join("   ")}`);
  }
}

/** What the generator shows the model, so a recheck judges numbers and terms the same way. */
function allowedTextFor(fixture: Fixture): string {
  return feedbackAllowedText({
    context: fixture.context,
    turns: fixture.turns,
    stats: computeInterviewStats(fixture.turns, fixture.durationSeconds ?? null, fixture.plannedSeconds),
  });
}

// ---------------------------------------------------------------- canary

async function canaryCommand(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const [reference] = positional;
  if (!reference) fail(`canary needs a reference run label.\n\n${USAGE}`);

  const stored = await readRunRecords<InterviewRunRecord>(reference);
  const only = flags.get("only");
  const wanted =
    typeof only === "string"
      ? stored.get(only)
      : [...stored.values()].find((record) => record.result.ok);
  if (!wanted) fail(`${typeof only === "string" ? `Fixture "${only}"` : "No usable fixture"} is not in run "${reference}".`);
  if (!wanted.result.ok) fail(`${wanted.fixture} failed in "${reference}"; pick another.`);

  const fixture = (await loadFixtures()).find((one) => one.id === wanted.fixture);
  if (!fixture) fail(`Fixture "${wanted.fixture}" no longer exists.`);

  console.log(`Canary: ${fixture.id} against ${reference}\n  reference: ${describeEngine(wanted.engine)}`);
  const fresh = await runFixture(fixture, `canary-${reference}`, FEEDBACK_TIMEOUT_MS);
  if (fresh.engine && fresh.model) fresh.engine.apiModelVersion = await readApiModelVersion(fresh.model);
  console.log(`  now:       ${describeEngine(fresh.engine)}`);

  if (!fresh.result.ok) {
    console.error(`\nFAILED: the call did not complete (${fresh.result.error.code}).`);
    process.exitCode = 1;
    return;
  }

  const differences: string[] = [];
  for (const key of ["modelVersion", "apiModelVersion", "temperature", "seed"] as const) {
    const before = wanted.engine?.[key] ?? "unrecorded";
    const after = fresh.engine?.[key] ?? "unrecorded";
    if (before !== after) differences.push(`${key}: ${before} -> ${after}`);
  }
  const sections = Object.keys(fresh.result.feedback) as Array<keyof InterviewFeedbackReport>;
  const reference_ = wanted.result.feedback;
  const changed = sections.filter(
    (section) => JSON.stringify(fresh.result.ok && fresh.result.feedback[section]) !== JSON.stringify(reference_[section]),
  );

  if (!differences.length && !changed.length) {
    console.log("\nUnchanged: same model, same sampling, byte-identical feedback.");
    return;
  }
  console.error("\nCHANGED:");
  for (const difference of differences) console.error(`  engine   ${difference}`);
  if (changed.length) console.error(`  output   ${changed.join(", ")}`);
  console.error("\nIf nothing of ours changed, the model behind the alias did. Re-read the\nsuite before trusting the feedback, and re-baseline deliberately.");
  process.exitCode = 1;
}

// ---------------------------------------------------------------- compare

const SCORE_ROWS: Array<[string, (feedback: InterviewFeedbackReport) => number]> = [
  ["Total", (f) => f.totalScore],
  ...FEEDBACK_CATEGORIES.map(
    (name) => [name, (f: InterviewFeedbackReport) => f.categoryScores.find((c) => c.name === name)?.score ?? NaN] as [string, (f: InterviewFeedbackReport) => number],
  ),
];

async function compareCommand(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const [labelA, labelB] = positional;
  if (!labelA || !labelB) fail(`compare needs two labels.\n\n${USAGE}`);

  const runA = await readRunRecords<InterviewRunRecord>(labelA);
  const runB = await readRunRecords<InterviewRunRecord>(labelB);
  requireComparable([[labelA, runA], [labelB, runB]], flags.has("force"));

  console.log(`A = ${labelA}  (${identity(runA)})`);
  console.log(`B = ${labelB}  (${identity(runB)})`);

  const ids = [...new Set([...runA.keys(), ...runB.keys()])].sort();
  const totalDeltas: number[] = [];
  const checkTotals = { A: 0, B: 0 };

  for (const id of ids) {
    const a = runA.get(id);
    const b = runB.get(id);
    console.log(`\n${id}`);
    if (!a || !b) {
      console.log(`  only in ${a ? "A" : "B"}`);
      continue;
    }
    if (!a.result.ok || !b.result.ok) {
      console.log(`  A: ${a.result.ok ? "ok" : `FAIL ${a.result.error.code}`}   B: ${b.result.ok ? "ok" : `FAIL ${b.result.error.code}`}`);
      continue;
    }
    const fa = a.result.feedback;
    const fb = b.result.feedback;
    console.log(`  ${"".padEnd(24)}${"A".padStart(7)}${"B".padStart(7)}${"Δ".padStart(8)}`);
    for (const [name, get] of SCORE_ROWS) {
      const delta = get(fb) - get(fa);
      console.log(`  ${name.padEnd(24)}${formatScore(get(fa)).padStart(7)}${formatScore(get(fb)).padStart(7)}${formatDelta(delta).padStart(8)}`);
    }
    console.log(`  Gaps        A: ${outcomeTally(fa)}`);
    console.log(`              B: ${outcomeTally(fb)}`);
    console.log(`  Checks      A: ${checkNote(a.checks) || "n/a"}`);
    console.log(`              B: ${checkNote(b.checks) || "n/a"}`);
    console.log(`  Guardrail   A: ${guardrailNote(a.guardrail) || "nothing fired"}`);
    console.log(`              B: ${guardrailNote(b.guardrail) || "nothing fired"}`);
    for (const [side, record] of [["A", a], ["B", b]] as const) {
      for (const violation of record.checks?.violations ?? []) {
        console.log(`    ${side} ! ${violation.check} ${violation.path}: ${truncate(violation.value)}${violation.note ? ` (${violation.note})` : ""}`);
      }
      checkTotals[side] += (record.checks?.violations ?? []).length;
    }
    console.log(`  Assertions  A: ${assertionNote(a.assertions) || "none"}`);
    console.log(`              B: ${assertionNote(b.assertions) || "none"}`);
    for (const [side, record] of [["A", a], ["B", b]] as const) {
      for (const assertion of record.assertions ?? []) {
        if (assertion.passed) continue;
        console.log(`    ${side} ! ${assertion.kind} ${assertion.in}: ${truncate(assertion.expression)}${assertion.found.length ? ` -> ${truncate(assertion.found.join(", "))}` : ""}`);
      }
    }
    totalDeltas.push(Math.abs(fb.totalScore - fa.totalScore));
  }

  const mean = totalDeltas.length ? totalDeltas.reduce((s, d) => s + d, 0) / totalDeltas.length : null;
  console.log("\nSummary");
  console.log(`  Mean |Δ total|      ${mean === null ? "n/a" : mean.toFixed(1)} over ${totalDeltas.length} fixture(s)`);
  console.log(`  Check violations    A: ${checkTotals.A}   B: ${checkTotals.B}   (lower is better)`);
  console.log(`\nFull output diff:\n  git diff --no-index ${display(path.join(RUNS_DIR, labelA))} ${display(path.join(RUNS_DIR, labelB))}`);
}

// ---------------------------------------------------------------- list

async function listCommand() {
  const fixtures = await loadFixtures();
  console.log("Interview fixtures");
  for (const fixture of fixtures) {
    const candidate = fixture.turns.filter((turn) => turn.role === "user").length;
    const assertions = Object.values(fixture.expect ?? {}).reduce((sum, group) => sum + (Array.isArray(group) ? group.length : 0), 0);
    const planned = fixture.plannedSeconds ? `${Math.round(fixture.plannedSeconds / 60)}-min` : "12-min";
    console.log(
      `  ${fixture.id.padEnd(26)} ${fixture.turns.length} turns (${candidate} candidate), ${fixture.context.gaps.length} gap(s), ${planned}, ${fixture.language ?? "en"}, ${assertions} assertion(s)`,
    );
  }
}

// ---------------------------------------------------------------- shared

async function loadFixtures(): Promise<Fixture[]> {
  if (!existsSync(FIXTURES_DIR)) fail(`No fixtures directory at ${display(FIXTURES_DIR)}.`);
  const names = (await readdir(FIXTURES_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const fixtures: Fixture[] = [];
  for (const name of names) {
    const base = path.join(FIXTURES_DIR, name);
    const meta = fixtureMetaSchema.safeParse(JSON.parse(await readFile(path.join(base, "fixture.json"), "utf8")));
    if (!meta.success) {
      fail(`${display(base)}/fixture.json: ${meta.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    const turns = z.array(transcriptTurnSchema).safeParse(JSON.parse(await readFile(path.join(base, "transcript.json"), "utf8")));
    if (!turns.success) fail(`${display(base)}/transcript.json is not a list of turns.`);

    for (const assertion of [...(meta.data.expect?.mustMatch ?? []), ...(meta.data.expect?.mustNotMatch ?? [])]) {
      try {
        new RegExp(assertion.pattern, "i");
      } catch (error) {
        fail(`${display(base)}/fixture.json: bad pattern ${JSON.stringify(assertion.pattern)} (${(error as Error).message})`);
      }
    }

    const requirements: Requirement[] = meta.data.context.requirements;
    fixtures.push({
      ...meta.data,
      id: name,
      turns: turns.data,
      context: {
        candidateName: meta.data.candidateName,
        language: meta.data.language ?? "en",
        role: meta.data.context.role,
        company: meta.data.context.company,
        jobDescription: meta.data.context.jobDescription,
        analysisSummary: meta.data.context.analysisSummary,
        requirements,
        gaps: requirementGaps(requirements),
      },
    });
  }
  return fixtures;
}
