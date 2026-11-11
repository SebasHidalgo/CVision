import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TargetLocale } from "@/lib/ai/prompts/translation.prompt";
import { finishAnalysis } from "@/lib/ai/resumeAnalysis";
import { withProse, type ProseMap } from "@/lib/ai/translatableProse";
import { analysisTranslationInput, feedbackTranslationInput, translateContent, type ContentTranslation, type TranslationJob } from "@/lib/ai/translation";
import { ruleKind, tokenPattern } from "@/lib/ai/translationTerms";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import { renderAnalysis } from "@/lib/i18n/analysisView";
import prisma from "@/lib/prisma";
import { resumeFeedbackSchema, type ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import esAnalysis from "@/locales/es/analysis.json";
import { costOf, type Tier } from "./pricing";
import { describeError, display, fail, parseFlags, RUNS_DIR, truncate, writeJson } from "./shared";
import { installEvalFetch, parseTier, planTier, readBudget, readLedger, runRouted, SpendGuard, usd } from "./spend";

/**
 * `npm run eval -- translate [<label>…] [--db ids] --to <new-label> [--only ids] [--twice ids] [--print ids] [--tier t]`
 *
 * Translates stored analyses (eval runs replayed through this checkout's finishAnalysis, free; or rows
 * of the app's database by id with --db, always real data) and stored interview feedback into Spanish
 * with the production call, guards and retries, on the routed tier (invented data on the free key,
 * real data on Flex), under the spend caps. `--twice` repeats an item's translation to check that the
 * same input returns the same output. Records, and every term decision (terms.tsv), go to runs/<new-label>/.
 */

type Fixture = { id: string; source: string; jobTitle: string; company?: string; jobDescription: string; cvText: string; cvAccentsComposed: number };

type Item = {
  key: string;
  fixture: string;
  source: string;
  kind: "analysis" | "interview";
  job: TranslationJob;
  /** The stored (structured) analysis, for the sentence check and --print. */
  feedback?: ResumeAnalysisFeedback;
};

type TranslationRecord = {
  key: string;
  fixture: string;
  source: string;
  kind: Item["kind"];
  engine: { tier?: string | null } | null;
  attempts?: number;
  callFailures?: string[];
  ms: number;
  ok: boolean;
  error?: string;
  strings: number;
  sourceChars: number;
  job: TranslationJob;
  result?: ContentTranslation;
  standardUsd?: number;
  /** Concept terms whose English is still in a rendered Spanish sentence. */
  sentenceEnglish?: string[];
};

const TARGET: TargetLocale = "es";
// Generous: the eval measures quality; production's deadline is the route's (see docs/i18n.md).
const EVAL_DEADLINE_MS = 120_000;

async function analysisItems(labels: string[], fixtures: Map<string, Fixture>, only?: Set<string>): Promise<Item[]> {
  const items: Item[] = [];
  for (const label of labels) {
    const dir = path.join(RUNS_DIR, label);
    if (!existsSync(dir)) fail(`No run named "${label}" in ${display(RUNS_DIR)}.`);
    for (const file of (await readdir(dir)).sort()) {
      if (!file.endsWith(".json") || file === "_run.json") continue;
      const record = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      if (record.kind === "interview" || !record.result?.ok) continue;
      const fixture = fixtures.get(record.fixture);
      if (!fixture || !record.answers || (only && !only.has(record.fixture))) continue;
      // The structured form production stores today: the stored answers through this checkout's code.
      const { feedback } = finishAnalysis({
        jobDescription: fixture.jobDescription,
        resumeText: fixture.cvText.slice(0, record.input.cvCharsSent),
        answer: record.answers.answer,
        repair: record.answers.repair,
        now: new Date(record.generatedAt),
        accentsComposed: fixture.cvAccentsComposed,
        logId: fixture.id,
      });
      const job = analysisTranslationInput({ id: "eval", companyName: fixture.company ?? "", jobTitle: fixture.jobTitle, feedback });
      items.push({ key: `${label}__${record.fixture}`, fixture: record.fixture, source: fixture.source, kind: "analysis", job, feedback });
    }
  }
  return items;
}

/** Analyses stored by the app, by id: real data, so never the free tier. Rows from before M9 have no structured sentences. */
async function databaseItems(ids: string[]): Promise<Item[]> {
  const rows = await prisma.resumeAnalysis.findMany({ where: { id: { in: ids } }, include: { feedback: { omit: { id: true, resumeId: true } } } });
  const items: Item[] = [];
  for (const id of ids) {
    const row = rows.find((one) => one.id === id);
    if (!row) fail(`No analysis ${id} in the database.`);
    const parsed = resumeFeedbackSchema.safeParse(row.feedback);
    if (!parsed.success) fail(`Analysis ${id} has feedback outside the schema.`);
    const fixture = `db-${id.slice(0, 8)}`;
    const job = analysisTranslationInput({ id, companyName: row.companyName, jobTitle: row.jobTitle, feedback: parsed.data });
    items.push({ key: fixture, fixture, source: "real", kind: "analysis", job, feedback: parsed.data });
  }
  return items;
}

async function interviewItems(labels: string[], only?: Set<string>): Promise<Item[]> {
  const items: Item[] = [];
  for (const label of labels) {
    const dir = path.join(RUNS_DIR, label);
    for (const file of (await readdir(dir)).sort()) {
      if (!file.endsWith(".json") || file === "_run.json") continue;
      const record = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      if (record.kind !== "interview" || !record.result?.ok || (only && !only.has(record.fixture))) continue;
      const metaFile = path.join(__dirname, "fixtures-interview", record.fixture, "fixture.json");
      const context = existsSync(metaFile) ? JSON.parse(await readFile(metaFile, "utf8")).context : null;
      const analysis = context
        ? {
            id: "eval",
            companyName: context.company,
            jobTitle: context.role,
            feedback: { jobFit: { requirements: context.requirements }, skills: { matchedSkills: [] } } as unknown as ResumeAnalysisFeedback,
          }
        : null;
      const job = feedbackTranslationInput({ id: "eval", report: record.result.feedback as InterviewFeedbackReport, role: context?.role ?? "", analysis });
      items.push({ key: `${label}__${record.fixture}`, fixture: record.fixture, source: record.source ?? "synthetic", kind: "interview", job });
    }
  }
  return items;
}

// About 2,600 prompt tokens around the strings; Spanish runs about 20 % longer; a retry now and then.
const estimateTokens = (job: TranslationJob) => {
  const chars = Object.values(job.sources).reduce((sum, text) => sum + text.length, 0) + job.terms.join(" ").length;
  return { input: 2_600 + Math.ceil(chars / 3.5), output: Math.ceil((chars * 1.3) / 3.5) + job.terms.length * 12 + 300 };
};

/** Concept terms whose English survives in the Spanish code-made sentences. */
function sentenceEnglish(feedback: ResumeAnalysisFeedback, result: ContentTranslation): string[] {
  const view = renderAnalysis(withProse(feedback, result.payload.strings), "es", { terms: result.payload.terms });
  const sentences = [
    ...(feedback.overall.headline ? [view.overall.summaryText] : []),
    ...(feedback.jobFit.outcomes ? [view.jobFit.description] : []),
    ...view.jobFit.requirements.filter((_, i) => feedback.jobFit.requirements[i].noteSentences).map((row) => row.note ?? ""),
  ].join("\n");
  return result.decisions
    .filter((d) => d.kind === "concept" && d.term.toLowerCase() !== (result.payload.terms[d.term] ?? d.text).toLowerCase() && result.payload.terms[d.term] !== undefined)
    .filter((d) => tokenPattern(d.term, "iu").test(sentences))
    .map((d) => d.term);
}

export async function translateCommand(args: string[], deps: { loadFixtures: () => Promise<Fixture[]> }) {
  const { positional, flags } = parseFlags(args);
  const to = flags.get("to");
  const dbIds = typeof flags.get("db") === "string" ? String(flags.get("db")).split(",").filter(Boolean) : [];
  if (typeof to !== "string" || !/^[\w.-]+$/.test(to) || (positional.length === 0 && dbIds.length === 0)) {
    fail("translate needs stored run labels or --db ids, and --to <new-label>.");
  }
  const outDir = path.join(RUNS_DIR, to);
  if (existsSync(outDir)) fail(`${display(outDir)} already exists.`);
  const only = typeof flags.get("only") === "string" ? new Set(String(flags.get("only")).split(",")) : undefined;
  const twice = typeof flags.get("twice") === "string" ? new Set(String(flags.get("twice")).split(",")) : new Set<string>();
  const print = typeof flags.get("print") === "string" ? new Set(String(flags.get("print")).split(",")) : new Set<string>();
  const asked = parseTier(flags.get("tier"));

  const fixtures = new Map((await deps.loadFixtures()).map((fixture) => [fixture.id, fixture]));
  const analysisLabels: string[] = [];
  const interviewLabels: string[] = [];
  for (const label of positional) {
    const run = JSON.parse(await readFile(path.join(RUNS_DIR, label, "_run.json"), "utf8").catch(() => "{}"));
    (run.kind === "interview" || label.includes("-i") ? interviewLabels : analysisLabels).push(label);
  }
  const items = [
    ...(await databaseItems(dbIds)),
    ...(await analysisItems(analysisLabels, fixtures, only)),
    ...(await interviewItems(interviewLabels, only)),
  ];
  await prisma.$disconnect();
  if (items.length === 0) fail("Nothing to translate.");

  installEvalFetch();
  await mkdir(outDir, { recursive: true });
  const runId = `${to}@${new Date().toISOString()}`;
  const guard = new SpendGuard(readBudget(), runId);
  const records: TranslationRecord[] = [];

  for (const item of items) {
    for (const pass of twice.has(item.fixture) ? [1, 2] : [1]) {
      const { tier } = planTier(item.source, asked);
      const tokens = estimateTokens(item.job);
      const estimateUsd = costOf("gemini-3.5-flash-lite", tier, tokens.input, tokens.output);
      const label = pass === 1 ? to : `${to}-rerun`;
      const outcome = await runRouted<TranslationRecord>(
        { command: "translate", label, runId, fixture: item.fixture, tier, estimateUsd },
        guard,
        async () => {
          const started = Date.now();
          const base = {
            key: item.key,
            fixture: item.fixture,
            source: item.source,
            kind: item.kind,
            engine: { tier: tier as string },
            strings: Object.keys(item.job.sources).length,
            sourceChars: Object.values(item.job.sources).reduce((sum, text) => sum + text.length, 0),
            job: item.job,
          };
          try {
            const result = await translateContent({ ...item.job, locale: TARGET, deadline: Date.now() + EVAL_DEADLINE_MS });
            const standardUsd = costOf(result.model, "standard", result.input ?? 0, result.output ?? 0);
            return { ...base, ms: Date.now() - started, ok: true, result, standardUsd, ...(item.feedback ? { sentenceEnglish: sentenceEnglish(item.feedback, result) } : {}) };
          } catch (error) {
            return { ...base, ms: Date.now() - started, ok: false, error: describeError(error).code };
          }
        },
      );
      if (!outcome.record) {
        console.log(`  stopped ${outcome.stopped}`);
        continue;
      }
      const record = outcome.record;
      records.push(record);
      if (pass === 1 && print.has(item.fixture) && item.feedback && record.result) printSpanish(item.feedback, record.result);
      await writeJson(path.join(outDir, `${item.key}${pass === 2 ? "__rerun" : ""}.json`), record);
      const stats = record.result?.stats;
      console.log(
        `  ${item.kind.padEnd(9)} ${item.fixture.padEnd(34)} ${String(record.engine?.tier).padEnd(5)} ${
          record.ok ? `${stats!.kept}/${stats!.strings} kept, ${stats!.fallbacks} fallback, ${stats!.calls} call(s), terms ${stats!.terms.names}n/${stats!.terms.concepts}c` : record.error
        } ${record.ms} ms${record.standardUsd !== undefined ? ` std ${usd(record.standardUsd)}` : ""}${pass === 2 ? " (rerun)" : ""}`,
      );
    }
  }
  await writeTermsTable(outDir, records);
  summarize(records, guard.spentThisRun(readLedger()));
}

/** Every term decision, with the M9 rule's kind beside the model's, for reading and labeling. */
async function writeTermsTable(outDir: string, records: TranslationRecord[]) {
  const lines = ["item\tterm\tmodel\trule\tforced\tsentence\ttext"];
  for (const record of records) {
    if (!record.result) continue;
    const texts = Object.values(record.job.sources);
    const sentence = new Set(record.job.sentenceTerms);
    for (const d of record.result.decisions) {
      lines.push([record.fixture, d.term, d.kind, ruleKind(d.term, texts), d.forced ? "forced" : "", sentence.has(d.term) ? "sentence" : "", d.text].join("\t"));
    }
  }
  await writeFile(path.join(outDir, "terms.tsv"), `${lines.join("\n")}\n`, "utf8");
}

function summarize(records: TranslationRecord[], spent: number) {
  const firsts = records.filter((record, i) => records.findIndex((other) => other.key === record.key) === i);
  const ok = firsts.filter((record) => record.ok);
  const sum = (pick: (record: TranslationRecord) => number) => ok.reduce((total, record) => total + pick(record), 0);
  const merge = (pick: (record: TranslationRecord) => Record<string, number | undefined>) => {
    const out: Record<string, number> = {};
    for (const record of ok) for (const [check, n] of Object.entries(pick(record))) out[check] = (out[check] ?? 0) + (n ?? 0);
    return out;
  };
  const latencies = ok.map((record) => record.ms).sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0;
  const stats = (record: TranslationRecord) => record.result!.stats;
  console.log(`\n${ok.length}/${firsts.length} translations completed (${firsts.length - ok.length} failed calls).`);
  console.log(`  strings ${sum((r) => stats(r).strings)}; translated ${sum((r) => stats(r).kept)}; fell back to English ${sum((r) => stats(r).fallbacks)}`);
  console.log(`  first answer failures by check: ${JSON.stringify(merge((r) => stats(r).counts))}`);
  console.log(`  left after retries by check:    ${JSON.stringify(merge((r) => stats(r).remaining))}`);
  console.log(`  calls ${sum((r) => stats(r).calls)} for ${ok.length} items; strings retried ${sum((r) => stats(r).retried)}`);
  console.log(`  names kept verbatim ${sum((r) => stats(r).protectedTerms.preserved)}/${sum((r) => stats(r).protectedTerms.present)}; digits ${sum((r) => stats(r).digits.preserved)}/${sum((r) => stats(r).digits.present)}`);
  console.log(
    `  terms ${sum((r) => stats(r).terms.total)}: names ${sum((r) => stats(r).terms.names)} (forced against the model ${sum((r) => stats(r).terms.forced)}), concepts ${sum((r) => stats(r).terms.concepts)}, term fallbacks ${sum((r) => stats(r).terms.fallbacks)}`,
  );
  const english = ok.flatMap((record) => (record.sentenceEnglish ?? []).map((term) => `${record.fixture}: ${term}`));
  console.log(`  concepts left in English in Spanish code sentences: ${english.length}${english.length ? ` (${english.slice(0, 8).join("; ")})` : ""}`);
  const disagree = ok.flatMap((record) =>
    record.result!.decisions.filter((d) => !d.forced && d.kind !== ruleKind(d.term, Object.values(record.job.sources))).map((d) => `${d.term}=${d.kind}`),
  );
  console.log(`  model vs M9 rule: ${disagree.length} of ${sum((r) => stats(r).terms.total)} decisions differ (see terms.tsv)`);
  for (const kind of ["analysis", "interview"] as const) {
    const of = ok.filter((record) => record.kind === kind);
    if (!of.length) continue;
    const cost = of.reduce((total, record) => total + (record.standardUsd ?? 0), 0) / of.length;
    const tokens = of.reduce((total, record) => total + (record.result!.input ?? 0) + (record.result!.output ?? 0), 0) / of.length;
    console.log(`  ${kind}: ${of.length}, mean ${usd(cost)} at standard prices, ${Math.round(tokens)} tokens, mean ${Math.round(of.reduce((t, r) => t + r.ms, 0) / of.length)} ms`);
  }
  console.log(`  latency median ${pct(0.5)} ms, p90 ${pct(0.9)} ms, max ${latencies[latencies.length - 1] ?? 0} ms; spent this run ${usd(spent)}`);
  const reruns = records.filter((record, i) => records.findIndex((other) => other.key === record.key) !== i);
  for (const rerun of reruns) {
    const first = firsts.find((record) => record.key === rerun.key)!;
    const same = JSON.stringify(first.result?.payload) === JSON.stringify(rerun.result?.payload);
    console.log(`  stability ${rerun.fixture}: ${same ? "byte-identical" : "DIFFERENT"}`);
  }
  for (const record of ok) {
    for (const failure of record.result!.stats.failures.slice(0, 4)) {
      console.log(`    ${record.fixture} try ${failure.attempt} ${failure.check} ${failure.path}: ${truncate(record.job.sources[failure.path] ?? "", 70)}`);
    }
  }
}

export type { Tier };

/** The analysis as a Spanish reader sees it: code-made sentences rendered in Spanish with the terms, the stored translation over the prose. */
function printSpanish(feedback: ResumeAnalysisFeedback, result: ContentTranslation) {
  const view = renderAnalysis(withProse(feedback, result.payload.strings), "es", { terms: result.payload.terms });
  const status = esAnalysis.status as Record<string, string>;
  const lines: string[] = ["", "=".repeat(80), `RESUMEN: ${view.overall.summaryText}`];
  for (const fix of view.overall.prioritizedFixes) lines.push(`ARREGLO [${fix.impact}] ${fix.title}: ${fix.action}`);
  lines.push(`\nREQUISITOS: ${view.jobFit.description}`);
  for (const row of view.jobFit.requirements) {
    lines.push(`  - [${row.kind}] ${status[row.status] ?? row.status}: ${row.requirement}`);
    if (row.evidence) lines.push(`      cita: "${row.evidence}"`);
    if (row.note) lines.push(`      nota: ${row.note}`);
  }
  for (const move of view.jobFit.strategicRecommendations) lines.push(`  movimiento: ${move}`);
  const section = (title: string, description: string, lists: Array<[string, string[]]>) => {
    lines.push(`\n${title}: ${description}`);
    for (const [name, items] of lists) for (const item of items) lines.push(`  ${name}: ${item}`);
  };
  section("EXPERIENCIA", view.experienceAndImpact.description, [["fortaleza", view.experienceAndImpact.strengths], ["debilidad", view.experienceAndImpact.weaknesses]]);
  for (const bullet of view.experienceAndImpact.suggestedBullets) for (const example of bullet.examples) lines.push(`  viñeta (${bullet.role}): ${example}`);
  section("HABILIDADES", view.skills.description, [["plan", view.skills.actionPlan], ["skill", view.skills.matchedSkills.map((skill) => `${skill.name} ("${skill.evidence}")`)]]);
  section("FORMACIÓN", view.educationAndCertifications.description, [["destacado", view.educationAndCertifications.highlights], ["mejora", view.educationAndCertifications.improvements]]);
  section("TONO", view.toneAndClarity.description, [["sugerencia", view.toneAndClarity.suggestions]]);
  section("ATS", view.atsCompatibility.description, [["problema", view.atsCompatibility.problems], ["arreglo", view.atsCompatibility.fixes]]);
  console.log(lines.join("\n"));
}
