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
import { LANGUAGE_NAMES } from "@/lib/ai/requirementLanguages";
import { guardTranslations, type TranslationGuardStats } from "@/lib/ai/translationGuards";
import { RESOURCES } from "@/lib/i18n/resources";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

/**
 * One call translates the model-written prose of one analysis or interview feedback. Temperature 0
 * and seed 7 come from the client, so the same input returns the same output. Results never change:
 * only prose is sent, and a string that fails a guard keeps its English original.
 */

// Measured on the eval's analyses (docs/i18n.md); the analysis page's maxDuration is 30 s.
export const TRANSLATION_TIMEOUT_MS = 25_000;

/** The interface's own labels, English → target, so prose and page use the same words. */
export function glossaryFor(locale: TargetLocale): Array<[string, string]> {
  const pairs: Array<[string, string]> = [...DOMAIN_GLOSSARY[locale]];
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

/**
 * A term is protected when it reads as a name: it has a digit or a symbol (C++, Node.js, CI/CD),
 * a capital past its first letter (SQL, PostgreSQL, Ruby on Rails), or it is one capitalized word the
 * sources use mid-sentence (Python, Kubernetes). "Leadership" at the start of a bullet is not, and
 * neither is a language name.
 */
function nameLike(term: string, sources: string[]): boolean {
  // A language is a name a translation must translate ("English" → "inglés"), never keep.
  if (LANGUAGE_NAMES.some((name) => name.toLowerCase() === term.toLowerCase())) return false;
  if (/[\p{N}+#./]/u.test(term) || /.\p{Lu}/u.test(term)) return true;
  if (!/^\p{Lu}\p{Ll}+$/u.test(term)) return false;
  const midSentence = new RegExp(`\\p{Ll}[,;:]?\\s+${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
  return sources.some((text) => midSentence.test(text));
}

const MAX_PROTECTED = 80;

/** Key terms, their CV words, matched skills, the company and the job title: what the translation must not touch. */
export function protectedTermsOf(
  feedback: Pick<ResumeAnalysisFeedback, "jobFit" | "skills"> | null,
  extra: string[],
  sources: ProseMap,
): string[] {
  const texts = Object.values(sources);
  const candidates = new Set<string>();
  for (const requirement of feedback?.jobFit.requirements ?? []) {
    for (const term of requirement.keyTerms?.terms ?? []) {
      candidates.add(term.term.trim());
      candidates.add(term.cvMatch.trim());
    }
  }
  for (const skill of feedback?.skills.matchedSkills ?? []) candidates.add(skill.name.trim());
  const names = [...candidates].filter((term) => term.length >= 1 && term.length <= 60 && nameLike(term, texts));
  const always = extra.map((term) => term.trim()).filter((term) => term.length >= 2);
  return [...new Set([...always, ...names])].sort((a, b) => b.length - a.length).slice(0, MAX_PROTECTED);
}

/** Hash of what is translated and how: a stored translation is reused only while this matches. */
export function translationSourceHash(sources: ProseMap, locale: TargetLocale): string {
  const ordered = Object.keys(sources)
    .sort()
    .map((path) => [path, sources[path]]);
  return createHash("sha256").update(JSON.stringify({ v: TRANSLATION_PROMPT_VERSION, locale, ordered })).digest("hex");
}

export type ProseTranslation = {
  kept: ProseMap;
  /** Every string as the model answered it, guards aside: for the eval only, never stored. */
  translated: ProseMap;
  stats: TranslationGuardStats;
  model: string;
  modelVersion: string | null;
  input: number | null;
  output: number | null;
};

/** Translates the prose and keeps what passes the guards. Throws the client's AppErrors on a failed call. */
export async function translateProse({
  sources,
  locale,
  protectedTerms,
  timeoutMs = TRANSLATION_TIMEOUT_MS,
}: {
  sources: ProseMap;
  locale: TargetLocale;
  protectedTerms: string[];
  timeoutMs?: number;
}): Promise<ProseTranslation> {
  const paths = Object.keys(sources);
  // Short ids: the paths stay in code, the model sees only an index.
  const ids = paths.map((_, i) => `s${i}`);
  const strings = Object.fromEntries(ids.map((id, i) => [id, sources[paths[i]]]));
  const schema = z.object(Object.fromEntries(ids.map((id) => [id, z.string()])));
  const answer = await generateJsonReported({
    system: TRANSLATION_SYSTEM,
    prompt: translationPrompt({ locale, glossary: glossaryFor(locale), protectedTerms, strings }),
    schema,
    timeoutMs,
  });
  const translated: ProseMap = {};
  ids.forEach((id, i) => {
    const text = (answer.value as Record<string, string | undefined>)[id];
    if (typeof text === "string") translated[paths[i]] = text;
  });
  const { kept, stats } = guardTranslations(sources, translated, protectedTerms);
  return { kept, translated, stats, model: answer.model, modelVersion: answer.modelVersion, input: answer.input, output: answer.output };
}

export type AnalysisForTranslation = { id: string; companyName: string; jobTitle: string; feedback: ResumeAnalysisFeedback };

/** What an analysis sends: its model prose, and the names in it that must come back verbatim. */
export function analysisTranslationInput(analysis: AnalysisForTranslation) {
  const sources = analysisProse(analysis.feedback);
  return { sources, protectedTerms: protectedTermsOf(analysis.feedback, [analysis.companyName, analysis.jobTitle], sources) };
}

export type FeedbackForTranslation = {
  /** InterviewFeedback.id */
  id: string;
  report: InterviewFeedbackReport;
  /** The analysis it was scored against, for its protected terms; null when it is gone. */
  analysis: AnalysisForTranslation | null;
  role: string;
};

/** What an interview feedback sends; its protected terms come from the analysis it was scored against. */
export function feedbackTranslationInput(feedback: FeedbackForTranslation) {
  const sources = feedbackProse(feedback.report);
  const extra = [feedback.role, ...(feedback.analysis ? [feedback.analysis.companyName, feedback.analysis.jobTitle] : [])];
  return { sources, protectedTerms: protectedTermsOf(feedback.analysis?.feedback ?? null, extra, sources) };
}
