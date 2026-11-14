import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { generateJsonReported } from "@/lib/ai/client";
import type { InterviewLanguage } from "@/lib/ai/postingLanguage";
import { SPOKEN_TITLE_PROMPT_VERSION, SPOKEN_TITLE_SYSTEM, spokenTitlePrompt } from "@/lib/ai/prompts/spoken-title.prompt";
import { digitGroups } from "@/lib/ai/translationGuards";

/**
 * The job title said in the interview's language when the posting is in the other one: one small call,
 * checked in code, retried once with what it broke. A title that still fails keeps its posting form.
 */

/** Short: it runs inside the session request, before the token call. */
export const SPOKEN_TITLE_TIMEOUT_MS = 6_000;
const MAX_ATTEMPTS = 2;
const MAX_TITLE_CHARS = 120;

/** Tokens a translation must carry over: acronyms, words with an inner capital or a digit, and dotted or symbol names (.NET, C#, Node.js). */
const KEPT_TOKEN = /^(?:\p{Lu}{2,}\p{Ll}?s?|\p{L}+\p{Lu}[\p{L}\p{N}]*|.*\p{N}.*|.*[.#+].*\p{L}.*|\p{L}+[.#+]+)$/u;
/** Acronyms Spanish says the other way round: either form carries it. */
const SAME_ACRONYM: Record<string, string> = { AI: "IA", IA: "AI", IT: "TI", TI: "IT" };

const tokens = (text: string) => text.split(/[\s,/()–—-]+/u).map((token) => token.replace(/^[^\p{L}\p{N}.#]+|[^\p{L}\p{N}#+]+$/gu, "")).filter(Boolean);

export type SpokenTitleCheck = "empty" | "length" | "digits" | "name" | "company";

/** What a translated title broke; empty when it passes. */
export function checkSpokenTitle(source: string, translated: string | undefined, company: string): SpokenTitleCheck[] {
  const text = (translated ?? "").replace(/\s+/g, " ").trim();
  if (!text) return ["empty"];
  const failed: SpokenTitleCheck[] = [];
  if (text.length > Math.min(MAX_TITLE_CHARS, source.length * 2.5 + 10)) failed.push("length");
  if (digitGroups(source).join(",") !== digitGroups(text).join(",")) failed.push("digits");
  const said = new Set(tokens(text));
  const lost = tokens(source).filter((token) => KEPT_TOKEN.test(token) && !said.has(token) && !(SAME_ACRONYM[token] && said.has(SAME_ACRONYM[token])));
  if (lost.length) failed.push("name");
  const name = company.trim();
  if (name.length >= 3 && text.toLowerCase().includes(name.toLowerCase()) && !source.toLowerCase().includes(name.toLowerCase())) failed.push("company");
  return failed;
}

const PROBLEMS: Record<SpokenTitleCheck, string> = {
  empty: "The title was empty.",
  length: "The title was much longer than the original: translate only the title.",
  digits: "Every number must stay exactly as in the original.",
  name: "Technology names and acronyms must stay exactly as written in the original.",
  company: "The company name is not part of the title: leave it out.",
};

/** Hash of what is translated and how: the stored title is reused only while it matches. */
export function spokenTitleHash(title: string, from: InterviewLanguage, to: InterviewLanguage): string {
  return createHash("sha256").update(JSON.stringify({ v: SPOKEN_TITLE_PROMPT_VERSION, title, from, to })).digest("hex");
}

export type SpokenTitleResult = {
  /** The translated title, or null when every attempt broke a check. */
  text: string | null;
  checks: SpokenTitleCheck[];
  attempts: number;
  model: string;
  modelVersion: string | null;
};

/** Translates the title; throws the client's AppErrors when the first call fails. */
export async function translateSpokenTitle({ title, company, from, to, deadline }: { title: string; company: string; from: InterviewLanguage; to: InterviewLanguage; deadline: number }): Promise<SpokenTitleResult> {
  let previous: string | null = null;
  let checks: SpokenTitleCheck[] = [];
  let model = "";
  let modelVersion: string | null = null;
  let attempts = 0;
  while (attempts < MAX_ATTEMPTS) {
    const timeoutMs = Math.min(SPOKEN_TITLE_TIMEOUT_MS, deadline - Date.now());
    if (timeoutMs < 1_000) break;
    let answer;
    try {
      answer = await generateJsonReported({
        system: SPOKEN_TITLE_SYSTEM,
        prompt: spokenTitlePrompt({ title, from, to, problems: checks.map((check) => PROBLEMS[check]), previous }),
        schema: z.object({ title: z.string() }),
        timeoutMs,
      });
    } catch (error) {
      // The first failure is the caller's to log; a failed retry leaves the first answer's checks standing.
      if (attempts === 0) throw error;
      break;
    }
    attempts += 1;
    model = answer.model;
    modelVersion = answer.modelVersion;
    previous = answer.value.title.replace(/\s+/g, " ").trim();
    checks = checkSpokenTitle(title, previous, company);
    if (checks.length === 0) return { text: previous, checks, attempts, model, modelVersion };
  }
  return { text: null, checks, attempts, model, modelVersion };
}
