import {
  groundQuotes,
  loosen,
  MAGNITUDE_WORDS,
  mentionsTerm,
  normalizeWhitespace,
  numbersIn,
  type GroundingKind,
  type Located,
} from "@/lib/ai/analysisChecks";
import { spanFor } from "@/lib/ai/analysisGuardrails";
import { isCandidateTurn } from "@/lib/ai/interviewStats";
import type { AiFeedback, InterviewStats } from "@/lib/ai/schemas";
import type { TranscriptTurn } from "@/lib/elevenlabs/postCall";
import type { Requirement } from "@/lib/schemas/resumeSchema";

/**
 * Content checks and guardrail for the interview feedback, the counterpart of
 * analysisChecks + analysisGuardrails for the analysis. Same contract: the
 * violations are what the model produced, counted before any edit; the
 * interventions are what was done about them on the way to the user; the
 * harness measures the first and reports the second.
 */

export type InterviewCheckName =
  /** A quote that is not a verbatim span of a CANDIDATE turn. */
  | "evidence-grounding"
  /** A strength or area whose anchor points at nothing in the answer. */
  | "anchor-invalid"
  /** gapFollowThrough does not have exactly one row per gap. */
  | "gap-coverage"
  /** A number in the prose that is in neither the transcript nor the posting. */
  | "fabricated-number"
  /** A technology-shaped term in the prose that is in neither. */
  | "fabricated-term";

export type InterviewCheckViolation = {
  check: InterviewCheckName;
  path: string;
  value: string;
  kind?: GroundingKind;
  note?: string;
  /** For a gap row whose name drifted from the issued text: the text to restore. */
  replacement?: string;
};

export type InterviewInterventionAction =
  | "quote-dropped"
  | "quote-normalized"
  | "item-dropped"
  /** A gap row's requirement text restored from the issued gap, matched by position. */
  | "gap-name-repaired"
  | "recorded";

export type InterviewIntervention = {
  check: InterviewCheckName;
  action: InterviewInterventionAction;
  path: string;
  /** Never logged in production: it carries what the candidate said. */
  value: string;
  replacement?: string;
};

export type InterviewInterventionCounts = Record<InterviewInterventionAction, number>;

export type InterviewGuardReport = {
  violations: InterviewCheckViolation[];
  interventions: InterviewIntervention[];
  counts: InterviewInterventionCounts;
};

export type InterviewCheckInput = {
  /** The CANDIDATE turns, joined: the only text a quote may come from. */
  candidateText: string;
  /** Everything the prose may legitimately name: whole transcript, posting, analysis, stats. */
  allowedText: string;
  gaps: Requirement[];
  feedback: AiFeedback;
  /** The measured stats, so a rounding of one ("about 400 words" for 398) is not an invention. */
  stats?: InterviewStats;
};

/** The candidate's words, one turn per line, as the grounding source. */
export function candidateText(turns: TranscriptTurn[]): string {
  return turns
    .filter(isCandidateTurn)
    .map((turn) => (turn.message ?? "").trim())
    .join("\n");
}

const emptyCounts = (): InterviewInterventionCounts => ({
  "quote-dropped": 0,
  "quote-normalized": 0,
  "item-dropped": 0,
  "gap-name-repaired": 0,
  recorded: 0,
});

function quoteFields(feedback: AiFeedback): Located[] {
  return [
    ...feedback.gapFollowThrough.map((row, i) => ({
      path: `gapFollowThrough[${i}].quote`,
      value: row.quote,
    })),
    ...feedback.notableAnswers.map((answer, i) => ({
      path: `notableAnswers[${i}].quote`,
      value: answer.quote,
    })),
  ];
}

/** The free text where an invented number or technology would hide. */
function proseFields(feedback: AiFeedback): Located[] {
  return [
    ...feedback.gapFollowThrough.map((row, i) => ({ path: `gapFollowThrough[${i}].note`, value: row.note })),
    ...feedback.notableAnswers.map((answer, i) => ({ path: `notableAnswers[${i}].why`, value: answer.why })),
    ...feedback.categoryScores.map((category, i) => ({ path: `categoryScores[${i}].comment`, value: category.comment })),
    ...feedback.strengths.map((item, i) => ({ path: `strengths[${i}].point`, value: item.point })),
    ...feedback.areasForImprovement.map((item, i) => ({ path: `areasForImprovement[${i}].point`, value: item.point })),
    { path: "finalAssessment", value: feedback.finalAssessment },
  ];
}

const anchorTargets = (feedback: AiFeedback) => ({
  notableAnswers: feedback.notableAnswers.length,
  gapFollowThrough: feedback.gapFollowThrough.length,
});

function checkAnchors(feedback: AiFeedback): InterviewCheckViolation[] {
  const sizes = anchorTargets(feedback);
  const lists = [
    ["strengths", feedback.strengths],
    ["areasForImprovement", feedback.areasForImprovement],
  ] as const;

  return lists.flatMap(([name, items]) =>
    items.flatMap((item, i) =>
      item.anchor.index < sizes[item.anchor.source]
        ? []
        : [
            {
              check: "anchor-invalid" as const,
              path: `${name}[${i}].anchor`,
              value: `${item.anchor.source}[${item.anchor.index}]`,
              note: `${item.anchor.source} has ${sizes[item.anchor.source]} entries`,
            },
          ],
    ),
  );
}

/** Whether a row's requirement text names this gap: equal, or one contains the other, loosely. */
function namesGap(rowRequirement: string, gap: string): boolean {
  const a = loosen(rowRequirement);
  const b = loosen(gap);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * One row per gap, no more, no fewer. Rows are matched to gaps by text; a
 * gap with no row, a row for no gap, and a gap with two rows are each
 * reported. Recorded, not corrected: adding a row would be a judgement the
 * model did not make, and removing one would hide what it said.
 *
 * One exception, repaired. The prompt asks for one row per gap in the
 * issued order, and the model sometimes copies a gap's text with a drift
 * (a typo fixed, a word dropped; seen in Spanish with "Conociamentos"), which
 * would otherwise count as a missing row and a stray row at once. When the
 * counts match and every unmatched gap sits at the index of an unmatched
 * row, the rows are the gaps by position: the violation names the drift
 * once and carries the issued text, which the guard restores.
 */
function checkGapCoverage(gaps: Requirement[], feedback: AiFeedback): InterviewCheckViolation[] {
  const violations: InterviewCheckViolation[] = [];
  const rows = feedback.gapFollowThrough;
  const matchedRows = new Set<number>();
  const gapsWithoutRow: number[] = [];

  gaps.forEach((gap, g) => {
    const matches = rows
      .map((row, i) => ({ row, i }))
      .filter(({ row, i }) => !matchedRows.has(i) && namesGap(row.requirement, gap.requirement));
    if (matches.length === 0) {
      gapsWithoutRow.push(g);
      return;
    }
    matchedRows.add(matches[0].i);
    for (const extra of matches.slice(1)) {
      matchedRows.add(extra.i);
      violations.push({ check: "gap-coverage", path: `gapFollowThrough[${extra.i}]`, value: extra.row.requirement, note: `second row for gap ${g + 1}` });
    }
  });

  const rowsWithoutGap = rows.map((_, i) => i).filter((i) => !matchedRows.has(i));
  const repairable =
    rows.length === gaps.length &&
    gapsWithoutRow.length > 0 &&
    gapsWithoutRow.length === rowsWithoutGap.length &&
    gapsWithoutRow.every((g) => rowsWithoutGap.includes(g));

  if (repairable) {
    for (const g of gapsWithoutRow) {
      violations.push({
        check: "gap-coverage",
        path: `gapFollowThrough[${g}].requirement`,
        value: rows[g].requirement,
        note: `name differs from gap ${g + 1}; repaired by position`,
        replacement: gaps[g].requirement,
      });
    }
    return violations;
  }

  for (const g of gapsWithoutRow) {
    violations.push({ check: "gap-coverage", path: `gapFollowThrough`, value: gaps[g].requirement, note: `no row for gap ${g + 1}` });
  }
  for (const i of rowsWithoutGap) {
    violations.push({ check: "gap-coverage", path: `gapFollowThrough[${i}]`, value: rows[i].requirement, note: "row for no listed gap" });
  }

  return violations;
}

/** How far a prose number may sit from a measured stat and still count as a rounding of it. */
export const STAT_ROUNDING_TOLERANCE = 0.02;

/** The stat values a number may be a rounding of, in the units the model sees and in minutes. */
function statValues(stats: InterviewStats | undefined): number[] {
  if (!stats) return [];
  const seconds = [
    stats.candidateOnFloorSeconds,
    stats.longestTurnGapSeconds,
    stats.durationSeconds,
    stats.plannedSeconds ?? null,
  ];
  return [
    stats.totalTurns,
    stats.candidateTurns,
    stats.candidateWords,
    stats.averageCandidateTurnWords,
    ...seconds,
    ...seconds.map((value) => (value === null ? null : value / 60)),
  ].filter((value): value is number => typeof value === "number" && value > 0);
}

const isRoundingOf = (number: number, values: number[]) =>
  values.some((value) => Math.abs(number - value) <= value * STAT_ROUNDING_TOLERANCE);

/**
 * Numbers in the prose that neither speaker said, the posting does not
 * state, and the measured stats do not account for within a rounding.
 * Scores the model restates ("a 60") would be flagged too, which is why the
 * field comments ask for reasons rather than numbers. Quantity words
 * ("dozens", "zero") are only checked inside quotes, where they would be an
 * invention; in prose they are ordinary writing ("zero hands-on experience").
 */
function checkFabricatedNumbers(
  allowedText: string,
  candidateText: string,
  feedback: AiFeedback,
  stats: InterviewStats | undefined,
): InterviewCheckViolation[] {
  const allowed = new Set(numbersIn(normalizeWhitespace(allowedText)));
  const measured = statValues(stats);

  const digits = proseFields(feedback).flatMap(({ path, value }) =>
    [...new Set(numbersIn(value))]
      .filter((number) => !allowed.has(number) && !isRoundingOf(Number(number), measured))
      .map((number) => ({
        check: "fabricated-number" as const,
        path,
        value: number,
        note: "number not in the transcript, the posting or the measured stats",
      })),
  );

  const words = quoteFields(feedback).flatMap(({ path, value }) =>
    MAGNITUDE_WORDS.filter(
      (word) =>
        mentionsTerm(value, word) &&
        !mentionsTerm(candidateText, word) &&
        !mentionsTerm(candidateText, word.replace(/s$/, "")),
    ).map((word) => ({
      check: "fabricated-number" as const,
      path,
      value: word,
      note: "quantity the candidate did not say",
    })),
  );

  return [...digits, ...words];
}

/**
 * Technology-shaped tokens: CamelCase words, acronyms of two letters or more,
 * dotted names such as Node.js, the C family, and any capitalized word that
 * is not the first of its sentence (a proper noun: a product, an employer, a
 * tool). Misses a lower-case technology ("docker") and over-reports a proper
 * noun used in passing; recorded only, so over-reporting costs nothing.
 */
const TECH_TOKEN = /(?<![A-Za-z0-9])(?:[A-Z][a-z]+(?:[A-Z][A-Za-z0-9]*)+|[A-Z]{2,}[A-Za-z0-9+#]*|[A-Za-z]+\.(?:js|JS|NET)|C\+\+|C#)(?![A-Za-z0-9])/g;
/** A capitalized word after a space that does not follow sentence punctuation. */
const MID_SENTENCE_PROPER = /(?<=[^.!?:\n"(]\s)([A-Z][a-z]+[a-z0-9+#]*)(?![A-Za-z0-9])/g;
/** Acronyms and words that are ordinary writing, not technologies. */
const TECH_STOPLIST = new Set(["OK", "AI", "CV", "HR", "IT", "UI", "UX", "STAR", "FYI", "TL;DR", "ATS", "English", "Spanish"]);

function checkFabricatedTerms(allowedText: string, feedback: AiFeedback): InterviewCheckViolation[] {
  return proseFields(feedback).flatMap(({ path, value }) => {
    const found = [
      ...(value.match(TECH_TOKEN) ?? []),
      ...[...value.matchAll(MID_SENTENCE_PROPER)].map((m) => m[1]),
    ];
    const terms = [...new Set(found)].filter(
      (term) => !TECH_STOPLIST.has(term) && !mentionsTerm(allowedText, term),
    );
    return terms.map((term) => ({
      check: "fabricated-term" as const,
      path,
      value: term,
      note: "technology not in the transcript or the posting",
    }));
  });
}

/** Every check, in one pass, before any edit. */
export function checkInterviewFeedback(input: InterviewCheckInput): InterviewCheckViolation[] {
  return [
    ...groundQuotes(input.candidateText, quoteFields(input.feedback)).map((violation) => ({
      check: "evidence-grounding" as const,
      ...violation,
    })),
    ...checkAnchors(input.feedback),
    ...checkGapCoverage(input.gaps, input.feedback),
    ...checkFabricatedNumbers(input.allowedText, input.candidateText, input.feedback, input.stats),
    ...checkFabricatedTerms(input.allowedText, input.feedback),
  ];
}

export function countInterviewChecks(
  violations: InterviewCheckViolation[],
): Record<InterviewCheckName, number> {
  const counts: Record<InterviewCheckName, number> = {
    "evidence-grounding": 0,
    "anchor-invalid": 0,
    "gap-coverage": 0,
    "fabricated-number": 0,
    "fabricated-term": 0,
  };
  for (const violation of violations) counts[violation.check] += 1;
  return counts;
}

/**
 * Guards one feedback. Quotes that cannot be found are dropped, not the row
 * that carries them: a gap row with no quotable evidence is still the
 * model's verdict on that gap, and the invented quote is the harm. A
 * strength or area whose anchor points at nothing is dropped whole, because
 * an unanchored point is exactly what the anchor exists to forbid.
 * Everything else is recorded and left alone.
 */
export function guardInterviewFeedback(input: InterviewCheckInput): {
  feedback: AiFeedback;
  guard: InterviewGuardReport;
} {
  const violations = checkInterviewFeedback(input);
  const interventions: InterviewIntervention[] = [];
  const counts = emptyCounts();
  const record = (intervention: InterviewIntervention) => {
    interventions.push(intervention);
    counts[intervention.action] += 1;
  };

  const cleaned: AiFeedback = structuredClone(input.feedback);

  for (const violation of violations) {
    switch (violation.check) {
      case "evidence-grounding": {
        const span =
          violation.kind === "case-or-punctuation"
            ? spanFor(input.candidateText, violation.value)
            : null;
        // A word-aligned span keeps the comma that ends the word; still a
        // verbatim span without it, and easier to read back.
        const quote = span ? span.replace(/[,;:]+$/, "") : "";
        writeQuote(cleaned, violation.path, quote);
        record({
          check: violation.check,
          action: span ? "quote-normalized" : "quote-dropped",
          path: violation.path,
          value: violation.value,
          ...(span ? { replacement: span.replace(/[,;:]+$/, "") } : {}),
        });
        break;
      }
      case "anchor-invalid": {
        blankItem(cleaned, violation.path);
        record({ check: violation.check, action: "item-dropped", path: violation.path, value: violation.value });
        break;
      }
      case "gap-coverage": {
        if (violation.replacement === undefined) {
          record({ check: violation.check, action: "recorded", path: violation.path, value: violation.value });
          break;
        }
        writeRequirement(cleaned, violation.path, violation.replacement);
        record({
          check: violation.check,
          action: "gap-name-repaired",
          path: violation.path,
          value: violation.value,
          replacement: violation.replacement,
        });
        break;
      }
      default:
        record({ check: violation.check, action: "recorded", path: violation.path, value: violation.value });
    }
  }

  cleaned.strengths = cleaned.strengths.filter((item) => item.point !== "");
  cleaned.areasForImprovement = cleaned.areasForImprovement.filter((item) => item.point !== "");

  return { feedback: cleaned, guard: { violations, interventions, counts } };
}

function writeQuote(feedback: AiFeedback, path: string, value: string) {
  const index = Number(/\[(\d+)\]/.exec(path)?.[1] ?? -1);
  if (index < 0) return;
  if (path.startsWith("gapFollowThrough")) feedback.gapFollowThrough[index].quote = value;
  else if (path.startsWith("notableAnswers")) feedback.notableAnswers[index].quote = value;
}

function writeRequirement(feedback: AiFeedback, path: string, value: string) {
  const index = Number(/\[(\d+)\]/.exec(path)?.[1] ?? -1);
  if (index < 0 || !feedback.gapFollowThrough[index]) return;
  feedback.gapFollowThrough[index].requirement = value;
}

/** Blanked rather than spliced so sibling paths stay valid; swept afterwards. */
function blankItem(feedback: AiFeedback, path: string) {
  const index = Number(/\[(\d+)\]/.exec(path)?.[1] ?? -1);
  if (index < 0) return;
  const list = path.startsWith("strengths") ? feedback.strengths : feedback.areasForImprovement;
  if (list[index]) list[index].point = "";
}

/** `quote-dropped 2, item-dropped 1` - or "" when nothing fired. */
export function describeInterviewCounts(counts: InterviewInterventionCounts): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([action, count]) => `${action} ${count}`)
    .join(", ");
}
