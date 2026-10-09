import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

/**
 * Content checks that compare an analysis against the CV text the model was
 * given. Pure functions: no I/O, no model, no session. The evaluation harness
 * runs them today; production can run the same functions later.
 *
 * They catch claims that contradict the CV, not bad judgement. Each check
 * documents what it cannot see.
 */

export type CheckName =
  | "evidence-grounding"
  | "false-missing"
  | "fabricated-number"
  | "missed-figure";

/**
 * How a quote fails, because the three need different fixes: a quote that is
 * nowhere in the CV is commentary or invention and belongs to the prompt; one
 * that differs only in case or punctuation is a normalization problem; one
 * stitched out of real fragments is the dangerous middle, since it reads as a
 * citation.
 */
export type GroundingKind = "not-found" | "case-or-punctuation" | "altered";

export type CheckViolation = {
  check: CheckName;
  /** Where in the analysis, e.g. `skills.matchedSkills[0].evidence`. */
  path: string;
  /** The offending text: the quote, the item, or the number. */
  value: string;
  /** Subcategory, for evidence-grounding only. */
  kind?: GroundingKind;
  /** Why it is reported, when the bare value doesn't say it. */
  note?: string;
};

type Located = { path: string; value: string };

/** Exported for the guardrails, which have to agree with the checks exactly. */
export const normalizeWhitespace = (text: string) =>
  text.replace(/\s+/g, " ").trim();

/** Lowercase, letters and digits only: ignores case and typography. */
export const loosen = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const escapeForRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whole-token match, case-insensitive. `\b` is wrong here: it would never
 * match an item ending in punctuation, such as `C++` or `C#`.
 */
export function mentionsTerm(haystack: string, term: string): boolean {
  return mentions(haystack, term);
}

function mentions(haystack: string, term: string): boolean {
  const pattern = new RegExp(
    `(?<![A-Za-z0-9])${escapeForRegex(term)}(?![A-Za-z0-9])`,
    "i",
  );
  return pattern.test(haystack);
}

/**
 * Every field whose contract is "text taken from the CV", audited against the
 * response format in lib/ai/prompts/cv-analysis.prompt.ts and against rule 5,
 * which names the same set.
 *
 * M2c-F widened this from two fields to six: the new shape asks for a quote in
 * four more places, and each one is a place a quote can be invented. The count
 * this produces is therefore stricter than the one from earlier phases, not
 * comparable to it.
 *
 * The free-text `description` fields also invite examples, but a quote cannot
 * be told from commentary inside prose, so they stay out.
 */
function quoteFields(feedback: ResumeAnalysisFeedback): Located[] {
  const ats = feedback.atsCompatibility;

  return [
    ...ats.evidence.map((value, i) => ({
      path: `atsCompatibility.evidence[${i}]`,
      value,
    })),
    ...ats.encodingArtifacts.map((value, i) => ({
      path: `atsCompatibility.encodingArtifacts[${i}]`,
      value,
    })),
    ...ats.sectionsDetected.map((value, i) => ({
      path: `atsCompatibility.sectionsDetected[${i}]`,
      value,
    })),
    ...feedback.skills.matchedSkills.map((skill, i) => ({
      path: `skills.matchedSkills[${i}].evidence`,
      value: skill.evidence,
    })),
    ...feedback.jobFit.requirements.map((requirement, i) => ({
      path: `jobFit.requirements[${i}].evidence`,
      value: requirement.evidence,
    })),
    ...feedback.experienceAndImpact.quantifiedAchievements.map(
      (achievement, i) => ({
        path: `experienceAndImpact.quantifiedAchievements[${i}].quote`,
        value: achievement.quote,
      }),
    ),
  ];
}

/**
 * Lists whose items are claimed to be absent from the CV. `recommendedCerts`
 * counts: recommending a certification the CV already lists is the same error.
 *
 * `missingSkills` and `missingKeywords` are gone from the output, so the two
 * lists that produced most of this check's findings no longer exist. What
 * replaced them is a requirement marked "missing", which is checkable the same
 * way: the requirement text is the thing claimed to be absent.
 */
function absenceClaims(feedback: ResumeAnalysisFeedback): Located[] {
  const certs = feedback.educationAndCertifications.recommendedCerts.map(
    (value, i) => ({
      path: `educationAndCertifications.recommendedCerts[${i}]`,
      value,
    }),
  );

  const missing = feedback.jobFit.requirements
    .map((requirement, i) => ({ requirement, i }))
    .filter(({ requirement }) => requirement.status === "missing")
    .map(({ requirement, i }) => ({
      path: `jobFit.requirements[${i}].requirement`,
      value: requirement.requirement,
    }));

  return [...certs, ...missing];
}

function suggestedBullets(feedback: ResumeAnalysisFeedback): Located[] {
  return feedback.experienceAndImpact.suggestedBullets.flatMap((bullet, b) =>
    bullet.examples.map((value, e) => ({
      path: `experienceAndImpact.suggestedBullets[${b}].examples[${e}]`,
      value,
    })),
  );
}

/** A quote is "altered" when this much of it is made of real CV fragments. */
const ALTERED_COVERAGE = 0.6;
/** Fragments shorter than this are ordinary words, not evidence of a quote. */
const ALTERED_MIN_RUN = 3;

/**
 * How much of `quote` is covered by contiguous runs of at least
 * ALTERED_MIN_RUN words taken from the CV, as a fraction of its length.
 */
function fragmentCoverage(looseCv: string, quote: string): number {
  const words = loosen(quote).split(" ").filter(Boolean);
  if (words.length === 0) return 0;

  const haystack = ` ${looseCv} `;
  let covered = 0;
  let at = 0;

  while (at < words.length) {
    let run = 0;
    for (let end = at + 1; end <= words.length; end += 1) {
      if (!haystack.includes(` ${words.slice(at, end).join(" ")} `)) break;
      run = end - at;
    }
    if (run >= ALTERED_MIN_RUN) {
      covered += run;
      at += run;
    } else {
      at += 1;
    }
  }

  return covered / words.length;
}

function classifyQuote(looseCv: string, quote: string): GroundingKind {
  if (looseCv.includes(loosen(quote))) return "case-or-punctuation";
  return fragmentCoverage(looseCv, quote) >= ALTERED_COVERAGE
    ? "altered"
    : "not-found";
}

const GROUNDING_NOTE: Record<GroundingKind, string | undefined> = {
  "not-found": undefined,
  "case-or-punctuation": "in the CV except for case or punctuation",
  altered: "stitched or abridged from real CV fragments",
};

/**
 * Quotes that are not in the CV, split by how they fail. Whitespace is
 * normalized on both sides; everything else must match exactly, so a quote the
 * model tidied up is reported as `case-or-punctuation` rather than passed.
 *
 * Misses: quotes embedded in the prose `description` fields, and a fabricated
 * quote that happens to be a verbatim span of the CV.
 */
export function checkEvidenceGrounding(
  cvText: string,
  feedback: ResumeAnalysisFeedback,
): CheckViolation[] {
  const cv = normalizeWhitespace(cvText);
  const looseCv = loosen(cvText);

  return quoteFields(feedback).flatMap(({ path, value }) => {
    const quote = normalizeWhitespace(value);
    if (!quote || cv.includes(quote)) return [];

    const kind = classifyQuote(looseCv, quote);
    return [
      {
        check: "evidence-grounding" as const,
        path,
        value: quote,
        kind,
        note: GROUNDING_NOTE[kind],
      },
    ];
  });
}

/**
 * Items called missing that the CV does mention. Case-insensitive, matched on
 * whole tokens.
 *
 * Misses: morphological variants, by design — "Scalability" will not match
 * "scalable", and no stemming is attempted. Also misses items the model phrases
 * as a sentence ("Kotlin is only briefly mentioned"), which match nothing.
 * Over-reports a term the CV uses in an unrelated sense.
 */
export function checkFalseMissing(
  cvText: string,
  feedback: ResumeAnalysisFeedback,
): CheckViolation[] {
  const cv = normalizeWhitespace(cvText);

  return absenceClaims(feedback).flatMap(({ path, value }) => {
    const item = normalizeWhitespace(value);
    if (!item || !mentions(cv, item)) return [];

    return [
      {
        check: "false-missing" as const,
        path,
        value: item,
        note: "the CV mentions it",
      },
    ];
  });
}

/**
 * Quantities that carry a claim, written as words rather than digits. Small
 * counts ("one", "three") are left out: they are ordinary prose, not metrics.
 */
const MAGNITUDE_WORDS = [
  "zero",
  "half",
  "double",
  "doubled",
  "triple",
  "tripled",
  "dozens",
  "hundreds",
  "thousands",
  "millions",
  "billions",
];

/** Digit runs, normalized: "1,200" and "1200." both become "1200". */
function numbersIn(text: string): string[] {
  return (text.match(/\d[\d.,]*/g) ?? []).map((token) =>
    token.replace(/[.,]+$/, "").replace(/,/g, ""),
  );
}

/**
 * Numbers in the suggested bullets that appear nowhere in the CV. These are
 * the most dangerous output in the product: a user pastes a rewritten bullet
 * into a real application.
 *
 * Misses: a fabricated number that coincides with an unrelated number in the
 * CV (a year, a street number), and any quantity in words outside
 * MAGNITUDE_WORDS. Over-reports when the model rewrites a CV metric into
 * another unit ("40%" as "0.4x").
 */
export function checkFabricatedNumbers(
  cvText: string,
  feedback: ResumeAnalysisFeedback,
): CheckViolation[] {
  const cv = normalizeWhitespace(cvText);
  const cvNumbers = new Set(numbersIn(cv));

  return suggestedBullets(feedback).flatMap(({ path, value }) => {
    const digits = [...new Set(numbersIn(value))]
      .filter((number) => !cvNumbers.has(number))
      .map((number) => ({ value: number, note: "not in the CV" }));

    const words = MAGNITUDE_WORDS.filter(
      (word) =>
        mentions(value, word) &&
        !mentions(cv, word) &&
        // "thousands" is covered by a CV that says "thousand".
        !mentions(cv, word.replace(/s$/, "")),
    ).map((word) => ({ value: word, note: "quantity not in the CV" }));

    return [...digits, ...words].map(({ value: found, note }) => ({
      check: "fabricated-number" as const,
      path,
      value: found,
      note,
    }));
  });
}

/**
 * Figures that measure an outcome, which is what belongs in
 * `quantifiedAchievements`. Deliberately narrow: a percentage, a multiplier or
 * a money amount is almost always a result, while a bare count is usually a
 * year, a team size or a version. Precision matters more than recall here,
 * because this check's whole job is to be believed when it fires.
 */
const OUTCOME_FIGURE = /\d+(?:\.\d+)?\s?%|(?<![A-Za-z])\d+(?:\.\d+)?x(?![A-Za-z])|[$€£]\s?\d/g;

/**
 * The CV states an outcome figure and the model reported none.
 *
 * One analysis missed this resume's only quantified achievement, left the
 * field empty, and then said figures were absent - consistent with its own
 * wrong finding rather than contradicting it, so no other check saw anything.
 * Recorded, never auto-filled: choosing which figure belongs in that field is
 * the model's judgement, and inserting one it did not select is a larger
 * intervention than editing a string.
 *
 * Misses a quantity written in words ("doubled throughput"), and a CV whose
 * only figures sit somewhere that is not an achievement.
 */
export function checkMissedFigures(
  cvText: string,
  feedback: ResumeAnalysisFeedback,
): CheckViolation[] {
  if (feedback.experienceAndImpact.quantifiedAchievements.length > 0) return [];

  const figures = [...new Set(normalizeWhitespace(cvText).match(OUTCOME_FIGURE) ?? [])];
  if (figures.length === 0) return [];

  return [
    {
      check: "missed-figure",
      path: "experienceAndImpact.quantifiedAchievements",
      value: figures.slice(0, 5).join(", "),
      note: `the CV states ${figures.length} outcome figure(s) and the field came back empty`,
    },
  ];
}

/** Every check, in one pass. */
export function checkAnalysis(
  cvText: string,
  feedback: ResumeAnalysisFeedback,
): CheckViolation[] {
  return [
    ...checkEvidenceGrounding(cvText, feedback),
    ...checkFalseMissing(cvText, feedback),
    ...checkFabricatedNumbers(cvText, feedback),
    ...checkMissedFigures(cvText, feedback),
  ];
}

export function countByCheck(
  violations: CheckViolation[],
): Record<CheckName, number> {
  const counts: Record<CheckName, number> = {
    "evidence-grounding": 0,
    "false-missing": 0,
    "fabricated-number": 0,
    "missed-figure": 0,
  };
  for (const violation of violations) counts[violation.check] += 1;
  return counts;
}

/** The grounding violations split by kind. One total hides three problems. */
export function countGrounding(
  violations: CheckViolation[],
): Record<GroundingKind, number> {
  const counts: Record<GroundingKind, number> = {
    "not-found": 0,
    "case-or-punctuation": 0,
    altered: 0,
  };
  for (const violation of violations) {
    if (violation.kind) counts[violation.kind] += 1;
  }
  return counts;
}
