import { groundQuotes, loosen, normalizeWhitespace } from "@/lib/ai/analysisChecks";
import { spanFor, type Intervention } from "@/lib/ai/analysisGuardrails";
import type { ModelRequirement, Requirement } from "@/lib/schemas/resumeSchema";

// M8-B: the requirement fields the model fills, checked in code. Pure; tested.

/** Replaces the model's note when a status is downgraded, so the note never argues for the old one. */
export const DOWNGRADE_NOTE = "No line in your CV could be quoted for this, so it isn't counted as met.";

/** The posting's own softening words; a clause without one is an example, an alternative or a remark, not a preferred item. */
const SOFTENING =
  /\b(?:plus|ideal|ideally|prefer\w*|bonus|nice[\s-]to[\s-]have|desirabl\w*|advantage\w*|great|helps?|idealmente|preferiblemente|preferentemente|deseable|valorable|valora\w*|ventaja)\b/i;

type Found = { text: string; normalized: boolean };

/** The quote as the posting has it: verbatim, or rewritten when only case or punctuation differ. */
function inPosting(posting: string, quote: string): Found | null {
  const text = normalizeWhitespace(quote);
  if (!text) return null;
  const [violation] = groundQuotes(posting, [{ path: "", value: text }]);
  if (!violation) return { text, normalized: false };
  if (violation.kind !== "case-or-punctuation") return null;
  const span = spanFor(posting, text);
  return span ? { text: span, normalized: true } : null;
}

const escapeForRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Separators and dangling conjunctions left at either end once a clause is cut out. */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/[,;:]\s*\./g, ".")
    .replace(/\s+/g, " ")
    .replace(/(?:[\s,;:.–—-]|\b(?:and|or|y|o)\b)+$/i, "")
    .replace(/^[\s,;:.–—-]+/, "")
    .trim();
}

/** The text with the clause cut out, or null when the clause is not in it or nothing would be left. */
export function withoutClause(text: string, clause: string): string | null {
  const words = normalizeWhitespace(clause).split(" ").filter(Boolean).map(escapeForRegex);
  if (words.length === 0) return null;
  const pattern = new RegExp(words.join("\\s+"), "i");
  if (!pattern.test(text)) return null;
  const rest = tidy(text.replace(pattern, " "));
  return rest.length >= 3 ? rest : null;
}

/** "ideally in e-commerce." -> "Ideally in e-commerce". */
export function clauseAsRequirement(clause: string): string {
  const text = clause.replace(/^[\s,;:.(–—-]+/, "").replace(/[\s,;:.)]+$/, "");
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** Before guardAnalysis: posting quote, section and softened clause. */
export function structureRequirements(
  posting: string,
  model: ModelRequirement[],
): { requirements: Requirement[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const requirements: Requirement[] = [];
  const record = (intervention: Intervention) => interventions.push(intervention);

  // A clause the model also listed as its own preferred entry must not be added twice.
  const listedPreferred = model
    .filter((entry) => entry.kind === "preferred")
    .flatMap((entry) => [loosen(entry.sourceQuote), loosen(entry.requirement)])
    .filter(Boolean);

  model.forEach((entry, index) => {
    const path = `jobFit.requirements[${index}]`;

    const source = inPosting(posting, entry.sourceQuote);
    if (!source) {
      record({ check: "posting-source", action: "requirement-dropped", path: `${path}.sourceQuote`, value: entry.requirement });
      return;
    }
    if (source.normalized) {
      record({ check: "posting-source", action: "quote-normalized", path: `${path}.sourceQuote`, value: entry.sourceQuote, replacement: source.text });
    }
    // The heading only anchors the section; one not in the posting is noted, not acted on.
    if (normalizeWhitespace(entry.heading) && !inPosting(posting, entry.heading)) {
      record({ check: "posting-source", action: "recorded", path: `${path}.heading`, value: entry.heading });
    }

    // Company, team, stack and offer never; the work only when it demands a capability.
    const describesOnly =
      entry.section === "description" || (entry.section === "responsibilities" && !entry.demandsCapability);
    if (describesOnly) {
      record({ check: "posting-section", action: "requirement-dropped", path: `${path}.section`, value: entry.requirement, replacement: entry.section });
      return;
    }

    const requirement: Requirement = {
      requirement: entry.requirement,
      kind: entry.kind,
      status: entry.status,
      evidence: entry.evidence,
      note: entry.note,
      sourceQuote: source.text,
      section: entry.section,
      assessable: entry.assessable,
    };
    requirements.push(requirement);

    const clause = entry.softenedClause;
    if (entry.kind !== "required" || !normalizeWhitespace(clause.quote)) return;

    const found = inPosting(posting, clause.quote);
    if (!found || !SOFTENING.test(found.text)) {
      record({ check: "softened-clause", action: "recorded", path: `${path}.softenedClause.quote`, value: clause.quote, replacement: found ? "no softening word" : "not in posting" });
      return;
    }

    const key = loosen(found.text);
    if (key === loosen(source.text)) {
      // The whole entry was the softened part: it is a preferred requirement.
      requirement.kind = "preferred";
      record({ check: "softened-clause", action: "kind-changed", path: `${path}.kind`, value: entry.requirement, replacement: "preferred" });
      return;
    }

    requirement.requirement = withoutClause(requirement.requirement, found.text) ?? requirement.requirement;
    const trimmed = withoutClause(source.text, found.text);
    const trimmedSource = trimmed ? inPosting(posting, trimmed) : null;
    if (trimmedSource) requirement.sourceQuote = trimmedSource.text;

    if (listedPreferred.some((text) => text === key || text.includes(key))) {
      record({ check: "softened-clause", action: "recorded", path: `${path}.softenedClause.quote`, value: found.text, replacement: "already listed" });
      return;
    }

    const derived: Requirement = {
      requirement: clauseAsRequirement(found.text),
      kind: "preferred",
      status: clause.status,
      evidence: clause.evidence,
      note: clause.note,
      sourceQuote: found.text,
      section: entry.section,
      assessable: entry.assessable,
    };
    requirements.push(derived);
    record({ check: "softened-clause", action: "requirement-split", path: `${path}.softenedClause`, value: found.text, replacement: derived.requirement });
  });

  return { requirements, interventions };
}

/** After guardAnalysis, so evidence it dropped counts as none. */
export function enforceRequirementStatuses(
  requirements: Requirement[],
): { requirements: Requirement[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];

  const enforced = requirements.map((original, index) => {
    const requirement = { ...original };
    const path = `jobFit.requirements[${index}].status`;
    // Analyses stored before the field existed read as assessable.
    const assessable = requirement.assessable !== false;

    if ((requirement.status === "met" || requirement.status === "partial") && !requirement.evidence.trim()) {
      const to = assessable ? "missing" : "not_evident";
      interventions.push({ check: "met-without-evidence", action: "status-downgraded", path, value: `${requirement.status}: ${requirement.requirement}`, replacement: to });
      requirement.status = to;
      requirement.note = DOWNGRADE_NOTE;
      return requirement;
    }

    if (requirement.status === "not_evident" && assessable) {
      interventions.push({ check: "not-evident", action: "status-coerced", path, value: `not_evident: ${requirement.requirement}`, replacement: "missing" });
      requirement.status = "missing";
    } else if (requirement.status === "missing" && !assessable) {
      interventions.push({ check: "not-evident", action: "status-coerced", path, value: `missing: ${requirement.requirement}`, replacement: "not_evident" });
      requirement.status = "not_evident";
    }
    return requirement;
  });

  return { requirements: enforced, interventions };
}
