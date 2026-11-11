import {
  checkAnalysis,
  groundQuotes,
  loosen,
  normalizeWhitespace,
  type CheckName,
  type CheckViolation,
} from "@/lib/ai/analysisChecks";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

/**
 * Applies the content checks as guardrails: the analysis that reaches the user
 * carries no quote that is not in their CV and no number the model invented.
 *
 * The hard requirement is that cleaning must not hide what was cleaned. A
 * guardrail that silently fixes the output would drive every violation count in
 * `npm run eval` to zero and cost us the only signal we have about the model
 * drifting, so this returns three things: the cleaned analysis, the violations
 * exactly as the checks found them before any edit, and a record of what was
 * done about each one. The harness measures the model from `violations`, which
 * stays comparable with every earlier phase, and reports `interventions`
 * alongside.
 */

export type InterventionAction =
  /** The quote was nowhere in the CV, or stitched: removed, item kept. */
  | "quote-dropped"
  /** The quote differed only in case or punctuation: rewritten as the CV has it. */
  | "quote-normalized"
  /** An invented figure became the placeholder the prompt already asks for. */
  | "number-placeheld"
  /** The figure could not be substituted cleanly, so the bullet went. */
  | "bullet-dropped"
  /** Logged and left alone, because correcting it is a bigger call than this. */
  | "recorded"
  /** A requirement whose posting quote is not in the posting, or that the posting only describes. */
  | "requirement-dropped"
  /** A softened clause became its own preferred requirement. */
  | "requirement-split"
  /** A required entry that was all softened clause became preferred. */
  | "kind-changed"
  /** met or partial with no CV quote behind it. */
  | "status-downgraded"
  /** not_evident on something a CV can show, or missing on something it cannot. */
  | "status-coerced"
  /** Key-term coverage or the years rule lowered the model's status. */
  | "status-capped"
  /** A key term not in the requirement's posting quote. */
  | "term-dropped"
  /** A key term's CV match not in the CV: emptied. */
  | "match-dropped"
  /** The requirement text rewritten in the posting's spelling or language. */
  | "text-replaced"
  /** A matched skill with no CV quote behind it, or not in the CV at all. */
  | "skill-dropped"
  /** Key terms marked as alternatives where the posting offers none: they all count. */
  | "mode-changed"
  /** A skills-list quote replaced by the experience or project line that shows the same term. */
  | "evidence-replaced"
  /** Split accents the PDF parser put back on their letters ("Jos´e" → "José"); counted per document. */
  | "accent-composed"
  /** An ATS problem without a quote from the CV, dropped with its fix. */
  | "problem-dropped"
  /** The analysis came back in another language and was asked again once. */
  | "regenerated"
  /** A qualification line of the posting no extracted entry covers. */
  | "requirement-uncovered"
  /** An uncovered line the repair call covered: a requirement added, a restatement or a non-requirement. */
  | "requirement-recovered"
  /** A not_evident requirement's CV quote, cleared: "Not shown in your CV" cannot quote the CV. */
  | "evidence-cleared"
  /** A repaired line that details or restates an item already listed, merged into it instead of added. */
  | "requirement-merged"
  /** An alternative the posting's quote offers and the key terms left out, added with the CV word that shows it. */
  | "alternative-added"
  /** A cap to missing not applied: an alternative in the quote could not be examined (another language, an elided noun). */
  | "cap-skipped"
  /** A recommendation that contradicts the final statuses, dropped. */
  | "recommendation-dropped"
  /** A sentence of the description stating requirement outcomes, replaced by the sentences written from the statuses. */
  | "sentence-dropped";

/** The requirement rules of lib/ai/requirementGuardrails.ts. */
export type RequirementCheckName =
  | "posting-source"
  | "posting-section"
  | "posting-kind"
  | "softened-clause"
  | "met-without-evidence"
  | "not-evident"
  | "key-term"
  | "years"
  | "unshowable-alternative"
  | "requirement-text"
  | "matched-skill"
  | "evidence-source"
  | "language-level"
  | "bullet-role"
  | "bullet-figure"
  /** Every qualification line of the posting covered by an entry: lib/ai/requirementCoverage.ts. */
  | "requirement-coverage"
  /** The PDF text itself, before the model: lib/pdfAccents.ts. */
  | "pdf-text"
  | "ats-problem"
  | "language"
  /** Prose that states requirement outcomes, written from the statuses: lib/ai/requirementProse.ts. */
  | "prose";

export type Intervention = {
  check: CheckName | RequirementCheckName;
  action: InterventionAction;
  /** Where in the analysis, e.g. `skills.matchedSkills[0].evidence`. */
  path: string;
  /** The offending text. Never logged in production: it carries CV content. */
  value: string;
  /** What it became, when the edit replaced rather than removed. */
  replacement?: string;
};

/** Counts only, so this can be logged without putting a CV in the logs. */
export type InterventionCounts = Record<InterventionAction, number>;

export type GuardReport = {
  /** As the checks found them, before any edit. The measurement. */
  violations: CheckViolation[];
  interventions: Intervention[];
  counts: InterventionCounts;
};

export type GuardedAnalysis = {
  feedback: ResumeAnalysisFeedback;
  guard: GuardReport;
};

const emptyCounts = (): InterventionCounts => ({
  "quote-dropped": 0,
  "quote-normalized": 0,
  "number-placeheld": 0,
  "bullet-dropped": 0,
  recorded: 0,
  "requirement-dropped": 0,
  "requirement-split": 0,
  "kind-changed": 0,
  "status-downgraded": 0,
  "status-coerced": 0,
  "status-capped": 0,
  "term-dropped": 0,
  "match-dropped": 0,
  "text-replaced": 0,
  "skill-dropped": 0,
  "mode-changed": 0,
  "evidence-replaced": 0,
  "accent-composed": 0,
  "problem-dropped": 0,
  regenerated: 0,
  "requirement-uncovered": 0,
  "requirement-recovered": 0,
  "evidence-cleared": 0,
  "requirement-merged": 0,
  "alternative-added": 0,
  "cap-skipped": 0,
  "recommendation-dropped": 0,
  "sentence-dropped": 0,
});

/** The report with more interventions in it, counted. */
export function withInterventions(report: GuardReport, more: Intervention[]): GuardReport {
  const counts = { ...report.counts };
  for (const intervention of more) counts[intervention.action] += 1;
  return { ...report, interventions: [...more, ...report.interventions], counts };
}

export type AtsIssue = { quote: string; problem: string; fix: string };

/**
 * The model's ATS issues as the stored problems and fixes: an issue whose
 * quote is not in the CV text is dropped with its fix ("Lack of traditional
 * contact icons" had nothing to quote). Without a CV text, all are kept.
 */
export function structureAtsIssues(
  issues: AtsIssue[],
  cvText: string,
): { problems: string[]; fixes: string[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const kept = issues.filter((issue, i) => {
    if (!cvText.trim()) return true;
    const miss = groundQuotes(cvText, [{ path: "", value: issue.quote }])[0];
    if (normalizeWhitespace(issue.quote) && (!miss || miss.kind === "case-or-punctuation")) return true;
    interventions.push({ check: "ats-problem", action: "problem-dropped", path: `atsCompatibility.issues[${i}]`, value: issue.problem, replacement: issue.quote ? "quote not in the CV" : "no quote" });
    return false;
  });
  return {
    problems: kept.map((issue) => issue.problem.trim()).filter(Boolean),
    fixes: [...new Set(kept.map((issue) => issue.fix.trim()).filter(Boolean))],
    interventions,
  };
}

/** One intervention per document, the count in it: how many split accents extraction composed. */
export function withAccentCompositions(report: GuardReport, composed: number): GuardReport {
  if (composed <= 0) return report;
  const intervention: Intervention = { check: "pdf-text", action: "accent-composed", path: "resumeText", value: String(composed) };
  return { ...report, interventions: [...report.interventions, intervention], counts: { ...report.counts, "accent-composed": composed } };
}

/**
 * The span of the source text that a quote differs from only in case or
 * punctuation. Walks word-aligned windows rather than comparing word counts,
 * because `loosen` splits on punctuation and "Node.js" is one word but two
 * loose ones. Shared with the interview guardrail.
 */
export function spanFor(cvText: string, quote: string): string | null {
  const target = loosen(quote);
  if (!target) return null;

  const words = normalizeWhitespace(cvText).split(" ");
  for (let start = 0; start < words.length; start += 1) {
    let span = "";
    for (let end = start; end < words.length; end += 1) {
      span = span ? `${span} ${words[end]}` : words[end];
      const loose = loosen(span);
      // `loosen` drops punctuation, so a span can match while carrying the
      // CV's own list marker: "- Built services" loosens to "built services".
      // Trimming the edges keeps the dash out of the quote.
      if (loose === target) return span.replace(/^[^\p{L}\p{N}]+/u, "");
      if (loose.length > target.length) break;
    }
  }
  return null;
}

/** `40%` -> `[X]%`, `1,200 users` -> `[N] users`, `$2m` -> `[$X]`. */
export function placeholderFor(bullet: string, number: string): string | null {
  // The digits as the bullet writes them, which may carry separators the
  // normalized value lost. Separators go BETWEEN digits only: allowing one
  // after the last digit swallowed the sentence's full stop.
  const written = new RegExp(
    `(\\$\\s?)?${[...number].join("[,.]?")}(\\s?%)?`,
  );
  const match = written.exec(bullet);
  if (!match) return null;

  const [found, currency, percent] = match;
  const replacement = percent ? "[X]%" : currency ? "[$X]" : "[N]";
  return bullet.replace(found, replacement);
}

/**
 * Guards one analysis. Quotes that cannot be found are dropped rather than the
 * item that carries them: a matched skill with no quotable evidence is still a
 * matched skill, and the fabricated quote is the harm, not the claim.
 */
export function guardAnalysis(
  cvText: string,
  feedback: ResumeAnalysisFeedback,
): GuardedAnalysis {
  const violations = checkAnalysis(cvText, feedback);
  const interventions: Intervention[] = [];
  const counts = emptyCounts();

  const record = (intervention: Intervention) => {
    interventions.push(intervention);
    counts[intervention.action] += 1;
  };

  // Structural clone: nothing below mutates what the model returned, so the
  // violations above stay the truth about it.
  const cleaned: ResumeAnalysisFeedback = structuredClone(feedback);

  /** One decision for every quoted field, keyed by the check's own path. */
  const quoteDecision = new Map<string, string>();

  for (const violation of violations) {
    if (violation.check !== "evidence-grounding") continue;

    if (violation.kind === "case-or-punctuation") {
      const span = spanFor(cvText, violation.value);
      // Typography, not invention: rewrite it the way the CV has it. Counted
      // separately so the rate stays visible without inflating the violations.
      if (span) {
        quoteDecision.set(violation.path, span);
        record({
          check: violation.check,
          action: "quote-normalized",
          path: violation.path,
          value: violation.value,
          replacement: span,
        });
        continue;
      }
    }

    quoteDecision.set(violation.path, "");
    record({
      check: violation.check,
      action: "quote-dropped",
      path: violation.path,
      value: violation.value,
    });
  }

  applyQuoteDecisions(cleaned, quoteDecision);

  // Invented figures: the advice is worth keeping, the number is not.
  const numbersByBullet = new Map<string, string[]>();
  for (const violation of violations) {
    if (violation.check !== "fabricated-number") continue;
    const list = numbersByBullet.get(violation.path) ?? [];
    list.push(violation.value);
    numbersByBullet.set(violation.path, list);
  }

  for (const [path, numbers] of numbersByBullet) {
    const located = locateBullet(cleaned, path);
    if (!located) continue;

    let text = located.text;
    const dropped: string[] = [];

    for (const number of numbers) {
      const next = /^\d/.test(number) ? placeholderFor(text, number) : null;
      if (next) {
        text = next;
        record({
          check: "fabricated-number",
          action: "number-placeheld",
          path,
          value: number,
          replacement: text,
        });
      } else {
        // A quantity in words ("zero downtime", "thousands of users") has no
        // placeholder form in the prompt's vocabulary, so there is no clean
        // substitution and the bullet goes.
        dropped.push(number);
      }
    }

    if (dropped.length > 0) {
      located.remove();
      for (const number of dropped) {
        record({
          check: "fabricated-number",
          action: "bullet-dropped",
          path,
          value: number,
        });
      }
      continue;
    }

    located.write(text);
  }

  /*
   * Recorded, not corrected, for two different reasons that happen to agree.
   *
   * A requirement marked missing that the CV mentions: flipping a status is a
   * larger intervention than editing a string, and this check lost reach when
   * requirements replaced the keyword lists, so its false positives cost more
   * than they used to.
   *
   * An outcome figure in the CV with an empty achievements field: choosing
   * which figure belongs there is the model's judgement, and supplying one it
   * did not pick would put words in the candidate's resume. Retrying is not an
   * option either - that is a second paid analysis.
   */
  for (const violation of violations) {
    if (violation.check !== "false-missing" && violation.check !== "missed-figure")
      continue;
    record({
      check: violation.check,
      action: "recorded",
      path: violation.path,
      value: violation.value,
    });
  }

  sweepEmptyBullets(cleaned);

  return { feedback: cleaned, guard: { violations, interventions, counts } };
}

/** Writes each decided quote back to the field its path names. */
function applyQuoteDecisions(
  feedback: ResumeAnalysisFeedback,
  decisions: Map<string, string>,
) {
  for (const [path, value] of decisions) {
    const index = Number(/\[(\d+)\]/.exec(path)?.[1] ?? -1);
    if (index < 0) continue;

    if (path.startsWith("atsCompatibility.evidence")) {
      feedback.atsCompatibility.evidence[index] = value;
    } else if (path.startsWith("atsCompatibility.encodingArtifacts")) {
      feedback.atsCompatibility.encodingArtifacts[index] = value;
    } else if (path.startsWith("atsCompatibility.sectionsDetected")) {
      feedback.atsCompatibility.sectionsDetected[index] = value;
    } else if (path.startsWith("skills.matchedSkills")) {
      feedback.skills.matchedSkills[index].evidence = value;
    } else if (path.startsWith("jobFit.requirements")) {
      feedback.jobFit.requirements[index].evidence = value;
    } else if (path.startsWith("experienceAndImpact.quantifiedAchievements")) {
      feedback.experienceAndImpact.quantifiedAchievements[index].quote = value;
    }
  }

  // A dropped quote leaves an empty string, which rule 5 already prefers to a
  // description. Empty entries in the three plain lists are noise, though.
  const ats = feedback.atsCompatibility;
  ats.evidence = ats.evidence.filter(Boolean);
  ats.encodingArtifacts = ats.encodingArtifacts.filter(Boolean);
  ats.sectionsDetected = ats.sectionsDetected.filter(Boolean);
}

/** The suggested bullet a `fabricated-number` path points at. */
function locateBullet(
  feedback: ResumeAnalysisFeedback,
  path: string,
): { text: string; write: (value: string) => void; remove: () => void } | null {
  const match = /suggestedBullets\[(\d+)\]\.examples\[(\d+)\]/.exec(path);
  if (!match) return null;

  const bullet = feedback.experienceAndImpact.suggestedBullets[Number(match[1])];
  const index = Number(match[2]);
  if (!bullet || typeof bullet.examples[index] !== "string") return null;

  return {
    text: bullet.examples[index],
    write: (value) => {
      bullet.examples[index] = value;
    },
    // Blanked rather than spliced, so the other numbers' paths stay valid;
    // swept up below.
    remove: () => {
      bullet.examples[index] = "";
    },
  };
}

/** Removes the bullets the guardrail blanked. */
function sweepEmptyBullets(feedback: ResumeAnalysisFeedback) {
  for (const bullet of feedback.experienceAndImpact.suggestedBullets) {
    bullet.examples = bullet.examples.filter(Boolean);
  }
  feedback.experienceAndImpact.suggestedBullets =
    feedback.experienceAndImpact.suggestedBullets.filter(
      (bullet) => bullet.examples.length > 0,
    );
}

/** For the paths where there is no CV text to check a quote against. */
export const emptyGuardReport = (): GuardReport => ({
  violations: [],
  interventions: [],
  counts: emptyCounts(),
});

/** `quote-dropped 2, number-placeheld 1` - or "" when nothing fired. */
export function describeCounts(counts: InterventionCounts): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([action, count]) => `${action} ${count}`)
    .join(", ");
}
