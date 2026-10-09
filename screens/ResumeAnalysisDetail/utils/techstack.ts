import {
  MAX_TECHSTACK_ITEM_CHARS,
  MAX_TECHSTACK_ITEMS,
} from "@/lib/schemas/interviewSchema";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

/**
 * Chips for the interview list, taken from the analysis instead of a model
 * call. `skills.matchedSkills` holds short names of skills the posting asks
 * for, which is chip-shaped. `jobFit.requirements` would be the complete
 * list, but its entries are whole qualification sentences (44-210 characters
 * in a real posting, 39-98 in the synthetic fixtures) and at most two of
 * seven fit a chip, so it is not used. A weak match can yield no chips; the
 * list renders without them.
 */
export function techstackFromAnalysis(
  feedback: ResumeAnalysisFeedback | null,
): string[] {
  if (!feedback) return [];

  const seen = new Set<string>();
  const chips: string[] = [];

  for (const skill of feedback.skills.matchedSkills) {
    const name = skill.name.replace(/\s+/g, " ").trim();
    const key = name.toLowerCase();
    if (!name || name.length > MAX_TECHSTACK_ITEM_CHARS || seen.has(key)) continue;
    seen.add(key);
    chips.push(name);
    if (chips.length === MAX_TECHSTACK_ITEMS) break;
  }

  return chips;
}
