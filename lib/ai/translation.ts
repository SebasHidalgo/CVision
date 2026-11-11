import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { generateJsonReported } from "@/lib/ai/client";
import {
  DOMAIN_GLOSSARY,
  TRANSLATION_PROMPT_VERSION,
  TRANSLATION_SYSTEM,
  translationPrompt,
  type TargetLocale,
} from "@/lib/ai/prompts/translation.prompt";
import { analysisProse, feedbackProse, type ProseMap } from "@/lib/ai/translatableProse";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import {
  carriedThrough,
  checkTerm,
  checkTranslation,
  fixInstructions,
  isHard,
  quotedSpans,
  type Concept,
  type Failure,
  type GuardContext,
  type TranslationCheck,
  type TranslationGuardStats,
} from "@/lib/ai/translationGuards";
import { forcedName, translationTerms, type TermKind } from "@/lib/ai/translationTerms";
import { analysisSentenceTerms } from "@/lib/i18n/analysisView";
import { RESOURCES } from "@/lib/i18n/resources";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

/**
 * One call translates the model-written prose of one analysis or interview feedback, and decides the
 * terms in it: names stay verbatim, concepts are translated (and render the code-made sentences in the
 * target language). Temperature 0 and seed 7 come from the client. Results never change: only prose
 * and the posting's terms are sent. Strings that fail a check are retried, telling the model what
 * they broke; only a string that still breaks a hard check after that keeps its English original.
 */

// Measured on the eval's analyses (docs/i18n.md); the analysis page's maxDuration is 30 s.
export const TRANSLATION_TIMEOUT_MS = 25_000;
export const MAX_RETRIES = 2;
// A retry needs at least this long, or it is skipped and the failures stand.
const MIN_RETRY_MS = 3_000;

/** The interface's own labels, English → target, so prose and page use the same words. */
export function interfaceLabels(locale: TargetLocale): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const en = RESOURCES.en;
  const target = RESOURCES[locale];
  const add = (ns: "analysis" | "feedback", path: string[]) => {
    const pick = (tree: unknown) => path.reduce<unknown>((at, key) => (at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined), tree);
    const from = pick(en[ns]);
    const to = pick(target[ns]);
    if (typeof from === "string" && typeof to === "string") pairs.push([from, to]);
  };
  for (const status of ["met", "partial", "missing", "not_evident"]) add("analysis", ["status", status]);
  for (const kind of ["required", "preferred"]) add("analysis", ["kind", kind]);
  for (const id of ["fit", "experience", "skills", "education", "tone", "ats"]) add("analysis", ["dimensions", id, "label"]);
  for (const outcome of ["addressed", "partially", "dodged", "notRaised"]) add("feedback", ["report", "outcome", outcome]);
  for (const category of ["communicationSkills", "technicalKnowledge", "problemSolving", "culturalFit", "confidenceAndClarity"]) {
    add("feedback", ["categories", category]);
  }
  return pairs;
}

/** Domain words and the interface's labels: the glossary the prompt sends. */
export function glossaryFor(locale: TargetLocale): Array<[string, string]> {
  return [...DOMAIN_GLOSSARY[locale], ...interfaceLabels(locale)];
}

/**
 * The domain glossary as exact terms, English (lowercase) → target: "applicant tracking system" and
 * "ATS" from "applicant tracking system (ATS)", each alternative of "CV / resume". Labels of the page
 * are left out: as terms they are rare, and a status word inside a sentence reads differently.
 */
export function glossaryTerms(locale: TargetLocale): Map<string, string> {
  const terms = new Map<string, string>();
  for (const [english, target] of DOMAIN_GLOSSARY[locale]) {
    const text = target.split(" / ")[0].trim();
    for (const alternative of english.split(" / ")) {
      const bare = alternative.replace(/\s*\([^)]*\)\s*/g, " ").trim().toLowerCase();
      if (bare) terms.set(bare, text);
    }
  }
  return terms;
}

/**
 * What a string may quote and translate: the interface's labels, and the examples the code-made
 * sentences quote (stored analyses from before M9 carry those sentences as text).
 */
export function quotableLabels(locale: TargetLocale): Map<string, string> {
  const labels = new Map(interfaceLabels(locale));
  const en = RESOURCES.en.sentences as Record<string, unknown>;
  const target = RESOURCES[locale].sentences as Record<string, unknown>;
  for (const [key, template] of Object.entries(en)) {
    const other = target[key] ?? target[key.replace(/_other$/, "_one")];
    if (typeof template !== "string" || typeof other !== "string") continue;
    const from = quotedSpans(template);
    const to = quotedSpans(other);
    from.forEach((span, i) => {
      if (to[i] && !span.includes("{{")) labels.set(span, to[i]);
    });
  }
  return labels;
}

/** Hash of what is translated and how: a stored translation is reused only while this matches. */
export function translationSourceHash(sources: ProseMap, locale: TargetLocale, terms: readonly string[] = [], names: readonly string[] = []): string {
  const ordered = Object.keys(sources)
    .sort()
    .map((path) => [path, sources[path]]);
  return createHash("sha256")
    .update(JSON.stringify({ v: TRANSLATION_PROMPT_VERSION, locale, ordered, terms: [...terms].sort(), names: [...names].sort() }))
    .digest("hex");
}

/** What a page stores and reads back. */
export type TranslationPayload = {
  strings: ProseMap;
  /** The sentence terms in the target language (names map to themselves). */
  terms: Record<string, string>;
};

const payloadSchema = z.object({ strings: z.record(z.string(), z.string()), terms: z.record(z.string(), z.string()) });

/** A stored payload; a row from before the terms (a plain prose map) reads as prose only. */
export function readPayload(value: unknown): TranslationPayload {
  const parsed = payloadSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const legacy = z.record(z.string(), z.string()).safeParse(value);
  return { strings: legacy.success ? legacy.data : {}, terms: {} };
}

export type TermDecision = { term: string; kind: TermKind; text: string; forced: boolean };

export type ContentTranslation = {
  payload: TranslationPayload;
  /** Every string as the model last answered it, guards aside: for the eval only, never stored. */
  translated: ProseMap;
  decisions: TermDecision[];
  stats: TranslationGuardStats;
  model: string;
  modelVersion: string | null;
  input: number | null;
  output: number | null;
  /** Which strings fell back to English and why: for the log and the eval, never the text. */
  fallbacks: Array<{ path: string; checks: TranslationCheck[] }>;
};

export type TranslateInput = {
  sources: ProseMap;
  locale: TargetLocale;
  /** Terms to decide: the sentence terms first, then the analysis' words found in the prose. */
  terms: string[];
  /** The sentence terms among them: their translations are stored. */
  sentenceTerms: string[];
  /** Always names: the company, the job title. */
  names: string[];
  /** Epoch ms by which every call must have returned. */
  deadline: number;
};

const answerSchema = (termIds: string[], stringIds: string[]) =>
  z.object({
    ...(termIds.length ? { terms: z.object(Object.fromEntries(termIds.map((id) => [id, z.object({ kind: z.enum(["name", "concept"]), text: z.string() })]))) } : {}),
    ...(stringIds.length ? { strings: z.object(Object.fromEntries(stringIds.map((id) => [id, z.string()]))) } : {}),
  });

type Answer = { terms?: Record<string, { kind: TermKind; text: string } | undefined>; strings?: Record<string, string | undefined> };

/** Translates the prose and decides the terms, retrying what fails. Throws the client's AppErrors when the first call fails. */
export async function translateContent({ sources, locale, terms, sentenceTerms, names, deadline }: TranslateInput): Promise<ContentTranslation> {
  const paths = Object.keys(sources);
  // Short ids: the paths stay in code, the model sees only an index.
  const stringId = new Map(paths.map((path, i) => [path, `s${i}`]));
  const termId = new Map(terms.map((term, i) => [term, `t${i}`]));
  const glossary = glossaryFor(locale);
  const labels = quotableLabels(locale);
  const always = new Set(names.map((name) => name.trim()).filter(Boolean));
  let model = "";
  let modelVersion: string | null = null;
  let input: number | null = null;
  let output: number | null = null;
  let calls = 0;

  const call = async (askTerms: string[], askPaths: string[], extra: Partial<Parameters<typeof translationPrompt>[0]>): Promise<Answer> => {
    const timeoutMs = Math.min(TRANSLATION_TIMEOUT_MS, deadline - Date.now());
    const answer = await generateJsonReported({
      system: TRANSLATION_SYSTEM,
      prompt: translationPrompt({
        locale,
        glossary,
        terms: Object.fromEntries(askTerms.map((term) => [termId.get(term)!, term])),
        strings: Object.fromEntries(askPaths.map((path) => [stringId.get(path)!, sources[path]])),
        ...extra,
      }),
      schema: answerSchema(askTerms.map((term) => termId.get(term)!), askPaths.map((path) => stringId.get(path)!)),
      timeoutMs,
    });
    calls += 1;
    model = answer.model;
    modelVersion = answer.modelVersion;
    input = (input ?? 0) + (answer.input ?? 0);
    output = (output ?? 0) + (answer.output ?? 0);
    return answer.value as Answer;
  };

  // First call: every term, then every string.
  const first = await call(terms, paths, {});
  const decisions = new Map<string, TermDecision>();
  const termFailures = new Map<string, Failure[]>();
  const glossed = glossaryTerms(locale);
  const decide = (term: string, answered: { kind: TermKind; text: string } | undefined) => {
    // A glossary entry is a concept with the glossary's words, however capitalized ("Applicant Tracking System").
    const fromGlossary = glossed.get(term.toLowerCase());
    if (fromGlossary) {
      decisions.set(term, { term, kind: "concept", text: fromGlossary, forced: answered?.kind === "name" });
      return;
    }
    const forced = forcedName(term) || always.has(term);
    // A retried term keeps the kind it was first given: only its text is fixed.
    const kind: TermKind = forced ? "name" : (decisions.get(term)?.kind ?? answered?.kind ?? "concept");
    decisions.set(term, { term, kind, text: kind === "name" ? term : (answered?.text?.trim() ?? ""), forced: forced && answered?.kind !== "name" });
  };
  for (const term of terms) decide(term, first.terms?.[termId.get(term)!]);
  const nameList = () => [...new Set([...always, ...[...decisions.values()].filter((d) => d.kind === "name").map((d) => d.term)])].sort((a, b) => b.length - a.length);
  const checkTerms = (list: string[]) => {
    for (const term of list) {
      const decision = decisions.get(term)!;
      const failed = decision.kind === "concept" ? checkTerm(term, decision.text, nameList(), locale) : [];
      if (failed.length) termFailures.set(term, failed);
      else termFailures.delete(term);
    }
  };
  checkTerms(terms);

  const latest: ProseMap = {};
  for (const path of paths) {
    const text = first.strings?.[stringId.get(path)!];
    if (typeof text === "string") latest[path] = text;
  }
  const context = (): GuardContext => ({
    locale,
    names: nameList(),
    concepts: [...decisions.values()]
      .filter((d) => d.kind === "concept")
      .map(({ term, text }): Concept => ({ term, text: termFailures.has(term) ? "" : text })),
    labels,
  });
  const failures = new Map<string, Failure[]>();
  const check = (list: string[]) => {
    const ctx = context();
    for (const path of list) {
      const failed = checkTranslation(sources[path], latest[path], ctx);
      if (failed.length) failures.set(path, failed);
      else failures.delete(path);
    }
  };
  check(paths);

  const log: TranslationGuardStats["failures"] = [];
  const counts: TranslationGuardStats["counts"] = {};
  for (const [path, failed] of failures) {
    for (const { check: name } of failed) {
      counts[name] = (counts[name] ?? 0) + 1;
      log.push({ path, check: name, attempt: 1 });
    }
  }
  const retried = new Set<string>();

  for (let attempt = 2; attempt <= MAX_RETRIES + 1; attempt += 1) {
    const askPaths = paths.filter((path) => failures.has(path));
    const askTerms = terms.filter((term) => termFailures.has(term));
    if (askPaths.length === 0 && askTerms.length === 0) break;
    if (deadline - Date.now() < MIN_RETRY_MS) break;
    askPaths.forEach((path) => retried.add(path));
    const fixes = Object.fromEntries([
      ...askPaths.map((path) => [stringId.get(path)!, { problems: fixInstructions(failures.get(path)!), previous: latest[path] }]),
      ...askTerms.map((term) => [termId.get(term)!, { problems: fixInstructions(termFailures.get(term)!), previous: decisions.get(term)!.text }]),
    ]);
    const decided = [...decisions.values()]
      .filter((d) => !termFailures.has(d.term))
      .map(({ term, kind, text }) => ({ term, kind, text }));
    let answer: Answer;
    try {
      answer = await call(askTerms, askPaths, { decided, fixes });
    } catch {
      // A failed retry leaves the first answer's failures standing.
      break;
    }
    for (const term of askTerms) decide(term, answer.terms?.[termId.get(term)!]);
    checkTerms(askTerms);
    for (const path of askPaths) {
      const text = answer.strings?.[stringId.get(path)!];
      if (typeof text === "string") latest[path] = text;
    }
    // Every string again: a concept fixed in this round changes what the others must not keep in English.
    check(paths);
    for (const [path, failed] of failures) for (const { check: name } of failed) log.push({ path, check: name, attempt });
  }

  // What is left: a hard failure keeps the English original; a soft one keeps the translation.
  const kept: ProseMap = {};
  const remaining: TranslationGuardStats["remaining"] = {};
  const fallbacks: ContentTranslation["fallbacks"] = [];
  for (const path of paths) {
    const failed = failures.get(path) ?? [];
    for (const { check: name } of failed) remaining[name] = (remaining[name] ?? 0) + 1;
    if (failed.some(isHard)) fallbacks.push({ path, checks: failed.map((one) => one.check) });
    else kept[path] = latest[path]!.trim();
  }
  let termFallbacks = 0;
  for (const term of termFailures.keys()) {
    const decision = decisions.get(term)!;
    decisions.set(term, { ...decision, text: term });
    termFallbacks += 1;
  }
  const finalNames = nameList();
  const sentenceSet = new Set(sentenceTerms);
  const payloadTerms = Object.fromEntries(
    [...decisions.values()].filter((d) => sentenceSet.has(d.term)).map((d) => [d.term, d.kind === "name" ? d.term : d.text || d.term]),
  );
  const all = [...decisions.values()];
  const stats: TranslationGuardStats = {
    strings: paths.length,
    kept: Object.keys(kept).length,
    calls,
    retried: retried.size,
    counts,
    remaining,
    fallbacks: fallbacks.length,
    failures: log,
    terms: {
      total: all.length,
      names: all.filter((d) => d.kind === "name").length,
      concepts: all.filter((d) => d.kind === "concept").length,
      forced: all.filter((d) => d.forced).length,
      fallbacks: termFallbacks,
    },
    ...carriedThrough(sources, kept, finalNames),
  };
  return { payload: { strings: kept, terms: payloadTerms }, translated: latest, decisions: all, stats, model, modelVersion, input, output, fallbacks };
}

export type AnalysisForTranslation = { id: string; companyName: string; jobTitle: string; feedback: ResumeAnalysisFeedback };

export type TranslationJob = { sources: ProseMap; terms: string[]; sentenceTerms: string[]; names: string[] };

/** What an analysis sends: its model prose, the terms its sentences name, and its words to decide. */
export function analysisTranslationInput(analysis: AnalysisForTranslation): TranslationJob {
  const sources = analysisProse(analysis.feedback);
  const sentenceTerms = analysisSentenceTerms(analysis.feedback);
  // The company is a name; the job title is a term like any other ("Frontend Engineer" may read "ingeniero frontend").
  const names = [analysis.companyName.trim()].filter(Boolean);
  return { sources, sentenceTerms, names, terms: translationTerms(analysis.feedback, [...names, analysis.jobTitle], sources, sentenceTerms) };
}

export type FeedbackForTranslation = {
  /** InterviewFeedback.id */
  id: string;
  report: InterviewFeedbackReport;
  /** The analysis it was scored against, for its terms; null when it is gone. */
  analysis: AnalysisForTranslation | null;
  role: string;
};

/** What an interview feedback sends; its terms come from the analysis it was scored against and its own prose. */
export function feedbackTranslationInput(feedback: FeedbackForTranslation): TranslationJob {
  const sources = feedbackProse(feedback.report);
  const names = feedback.analysis ? [feedback.analysis.companyName.trim()].filter(Boolean) : [];
  const candidates = [...names, feedback.role, ...(feedback.analysis ? [feedback.analysis.jobTitle] : [])];
  return { sources, sentenceTerms: [], names, terms: translationTerms(feedback.analysis?.feedback ?? null, candidates, sources) };
}

/** True when there is nothing for a translation to do. */
export const nothingToTranslate = (job: TranslationJob) => Object.keys(job.sources).length === 0 && job.sentenceTerms.length === 0;
