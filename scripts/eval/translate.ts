import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { TargetLocale } from "@/lib/ai/prompts/translation.prompt";
import { finishAnalysis } from "@/lib/ai/resumeAnalysis";
import { analysisProse, type ProseMap } from "@/lib/ai/translatableProse";
import { feedbackTranslationInput, protectedTermsOf, translateProse, type ProseTranslation } from "@/lib/ai/translation";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import { costOf, type Tier } from "./pricing";
import { describeError, display, fail, parseFlags, RUNS_DIR, truncate, writeJson } from "./shared";
import { installEvalFetch, parseTier, planTier, readBudget, readLedger, runRouted, SpendGuard, usd } from "./spend";

/**
 * `npm run eval -- translate <label> [<label>…] --to <new-label> [--only ids] [--twice ids] [--tier t]`
 *
 * Translates stored analyses (replayed through this checkout's finishAnalysis, free) and stored
 * interview feedback into Spanish with the production call and guards, on the routed tier
 * (invented data on the free key, real data on Flex), under the spend caps. `--twice` repeats a
 * fixture's call to check that the same input returns the same output. Records go to runs/<new-label>/.
 */

type Fixture = { id: string; source: string; jobTitle: string; company?: string; jobDescription: string; cvText: string; cvAccentsComposed: number };

type Item = {
  key: string;
  fixture: string;
  source: string;
  kind: "analysis" | "interview";
  sources: ProseMap;
  protectedTerms: string[];
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
  protectedTerms: string[];
  result?: Omit<ProseTranslation, "kept"> & { kept: ProseMap };
  standardUsd?: number;
  sources: ProseMap;
};

const TARGET: TargetLocale = "es";

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
      const sources = analysisProse(feedback);
      items.push({
        key: `${label}__${record.fixture}`,
        fixture: record.fixture,
        source: fixture.source,
        kind: "analysis",
        sources,
        protectedTerms: protectedTermsOf(feedback, [fixture.company ?? "", fixture.jobTitle], sources),
      });
    }
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
      const input = feedbackTranslationInput({ id: "eval", report: record.result.feedback as InterviewFeedbackReport, role: context?.role ?? "", analysis });
      items.push({ key: `${label}__${record.fixture}`, fixture: record.fixture, source: record.source ?? "synthetic", kind: "interview", ...input });
    }
  }
  return items;
}

// About 1,800 prompt tokens around the strings, and Spanish runs about 20 % longer than English.
const estimateTokens = (sources: ProseMap) => {
  const chars = Object.values(sources).reduce((sum, text) => sum + text.length, 0);
  return { input: 1_800 + Math.ceil(chars / 3.5), output: Math.ceil((chars * 1.25) / 3.5) + 200 };
};

export async function translateCommand(args: string[], deps: { loadFixtures: () => Promise<Fixture[]> }) {
  const { positional, flags } = parseFlags(args);
  const to = flags.get("to");
  if (typeof to !== "string" || !/^[\w.-]+$/.test(to) || positional.length === 0) {
    fail("translate needs stored run labels and --to <new-label>.");
  }
  const outDir = path.join(RUNS_DIR, to);
  if (existsSync(outDir)) fail(`${display(outDir)} already exists.`);
  const only = typeof flags.get("only") === "string" ? new Set(String(flags.get("only")).split(",")) : undefined;
  const twice = typeof flags.get("twice") === "string" ? new Set(String(flags.get("twice")).split(",")) : new Set<string>();
  const asked = parseTier(flags.get("tier"));

  const fixtures = new Map((await deps.loadFixtures()).map((fixture) => [fixture.id, fixture]));
  const analysisLabels: string[] = [];
  const interviewLabels: string[] = [];
  for (const label of positional) {
    const run = JSON.parse(await readFile(path.join(RUNS_DIR, label, "_run.json"), "utf8").catch(() => "{}"));
    (run.kind === "interview" || label.includes("-i") ? interviewLabels : analysisLabels).push(label);
  }
  const items = [...(await analysisItems(analysisLabels, fixtures, only)), ...(await interviewItems(interviewLabels, only))];
  if (items.length === 0) fail("Nothing to translate in those runs.");

  installEvalFetch();
  await mkdir(outDir, { recursive: true });
  const runId = `${to}@${new Date().toISOString()}`;
  const guard = new SpendGuard(readBudget(), runId);
  const records: TranslationRecord[] = [];

  for (const item of items) {
    for (const pass of twice.has(item.fixture) ? [1, 2] : [1]) {
      const { tier } = planTier(item.source, asked);
      const tokens = estimateTokens(item.sources);
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
            strings: Object.keys(item.sources).length,
            sourceChars: Object.values(item.sources).reduce((sum, text) => sum + text.length, 0),
            protectedTerms: item.protectedTerms,
            sources: item.sources,
          };
          try {
            const result = await translateProse({ sources: item.sources, locale: TARGET, protectedTerms: item.protectedTerms });
            const standardUsd = costOf(result.model, "standard", result.input ?? 0, result.output ?? 0);
            return { ...base, ms: Date.now() - started, ok: true, result, standardUsd };
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
      await writeJson(path.join(outDir, `${item.key}${pass === 2 ? "__rerun" : ""}.json`), record);
      const stats = record.result?.stats;
      console.log(
        `  ${item.kind.padEnd(9)} ${item.fixture.padEnd(34)} ${String(record.engine?.tier).padEnd(5)} ${record.ok ? `${stats!.kept}/${stats!.strings} kept` : record.error} ${record.ms} ms${record.standardUsd !== undefined ? ` std ${usd(record.standardUsd)}` : ""}${pass === 2 ? " (rerun)" : ""}`,
      );
    }
  }
  summarize(records, guard.spentThisRun(readLedger()));
}

function summarize(records: TranslationRecord[], spent: number) {
  const firsts = records.filter((record, i) => records.findIndex((other) => other.key === record.key) === i);
  const ok = firsts.filter((record) => record.ok);
  const sum = (pick: (record: TranslationRecord) => number) => ok.reduce((total, record) => total + pick(record), 0);
  const counts: Record<string, number> = {};
  for (const record of ok) for (const [check, n] of Object.entries(record.result!.stats.counts)) counts[check] = (counts[check] ?? 0) + (n ?? 0);
  const latencies = ok.map((record) => record.ms).sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0;
  console.log(`\n${ok.length}/${firsts.length} translations completed (${firsts.length - ok.length} failed calls).`);
  console.log(`  strings kept ${sum((r) => r.result!.stats.kept)}/${sum((r) => r.result!.stats.strings)}; guard failures by check: ${JSON.stringify(counts)}`);
  console.log(`  protected terms preserved ${sum((r) => r.result!.stats.protectedTerms.preserved)}/${sum((r) => r.result!.stats.protectedTerms.present)}; digits preserved ${sum((r) => r.result!.stats.digits.preserved)}/${sum((r) => r.result!.stats.digits.present)}`);
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
    const same = JSON.stringify(first.result?.kept) === JSON.stringify(rerun.result?.kept) && JSON.stringify(first.result?.stats) === JSON.stringify(rerun.result?.stats);
    console.log(`  stability ${rerun.fixture}: ${same ? "byte-identical" : "DIFFERENT"}`);
  }
  for (const record of ok) {
    for (const failure of record.result!.stats.failures.slice(0, 3)) {
      console.log(`    ${record.fixture} ${failure.check} ${failure.path}: ${truncate(record.sources[failure.path] ?? "", 70)}`);
    }
  }
}

export type { Tier };
