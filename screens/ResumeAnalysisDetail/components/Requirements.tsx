import type { TFunction } from "i18next";
import { StatusMark, type MarkStatus } from "@/components/design-system/StatusMark";
import { Surface } from "@/components/design-system/Surface";
import Prose from "@/components/i18n/Prose";
import { termDisplay, type TermChip } from "@/lib/ai/requirementGuardrails";
import type { KeyTerms, Requirement, RequirementStatus, requirementTally } from "@/lib/schemas/resumeSchema";
import { cn } from "@/lib/utils";
import { groupRequirements, shownKind, type RequirementGroupId } from "../utils/requirementOrder";
import { CvQuote } from "./CvQuote";

type AnalysisT = TFunction<"analysis">;

type RequirementsProps = {
  requirements: Requirement[];
  tally: ReturnType<typeof requirementTally>;
  t: AnalysisT;
};

const MARK: Record<RequirementStatus, MarkStatus> = { met: "met", partial: "partial", missing: "missing", not_evident: "notshown" };

const GROUP_TITLE = {
  required: "requirements.requiredTitle",
  preferred: "requirements.preferredTitle",
  notShown: "status.not_evident",
} as const satisfies Record<RequirementGroupId, string>;

/**
 * One row per requirement in the posting, in the page's order (requirementOrder.ts): required, then preferred,
 * met before partly met before not met, and what a CV can't show last. The counts beside each group are the
 * verdict's arithmetic.
 */
export function Requirements({ requirements, tally, t }: RequirementsProps) {
  if (requirements.length === 0) {
    return <p className="text-ed-body text-ed-ink-2">{t("requirements.none")}</p>;
  }

  return (
    <div className="grid gap-10">
      {groupRequirements(requirements).map(({ id, rows }) => {
        const count = id === "notShown" ? null : tally[id];
        return (
          <div key={id} className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h3 className="text-ed-h3 font-semibold text-ed-ink">{t(GROUP_TITLE[id])}</h3>
              {count && (
                <p className="text-[15px] text-ed-ink-2 tabular-nums">
                  {count.partial > 0
                    ? t("requirements.countWithPartial", { met: count.met, total: count.total, partial: count.partial })
                    : t("requirements.count", { met: count.met, total: count.total })}
                </p>
              )}
            </div>
            {id === "notShown" && <p className="max-w-[65ch] text-ed-body text-ed-ink-2">{t("requirements.notShownAdvice")}</p>}
            <Surface as="ul" className="px-5 max-sm:px-4">
              {rows.map((requirement, i) => (
                <RequirementRow
                  key={i}
                  requirement={requirement}
                  // Under "Not shown in your CV" the status is the group: the row says its kind instead.
                  label={id === "notShown" ? t(`kind.${shownKind(requirement)}`) : t(`status.${requirement.status}`)}
                  t={t}
                />
              ))}
            </Surface>
          </div>
        );
      })}
    </div>
  );
}

function RequirementRow({ requirement, label, t }: { requirement: Requirement; label: string; t: AnalysisT }) {
  const claimed = requirement.status === "met" || requirement.status === "partial";
  const onlyListed = claimed && requirement.skillsOnly === true;
  const onlyClaimed = claimed && requirement.summaryOnly === true;
  const notShown = requirement.status === "not_evident";
  // A stored "Not shown in your CV" row may still carry the quote cleared since M8-F.
  const evidence = notShown ? "" : requirement.evidence;
  // No CV can show these by definition: a ✓ or ✗ here would contradict the group they sit in.
  const keyTerms = !notShown && requirement.keyTerms && requirement.keyTerms.terms.length > 0 ? requirement.keyTerms : null;

  return (
    <li
      data-requirement-status={requirement.status}
      data-requirement-kind={shownKind(requirement)}
      className="grid gap-x-6 gap-y-3 border-b border-ed-line py-5 last:border-b-0 sm:grid-cols-[9.5rem_minmax(0,1fr)]"
    >
      {/* Seen beside the row; heard as part of its heading, so moving by headings still gives each status. */}
      <p aria-hidden className="inline-flex items-center gap-2.5 self-start text-[15px] leading-[1.6] text-ed-ink">
        <StatusMark status={MARK[requirement.status]} />
        {label}
      </p>
      <div className="grid min-w-0 max-w-[68ch] gap-3">
        <h4 className="text-[17px] leading-[1.45] font-medium break-words text-ed-ink">
          <span className="sr-only">{label}: </span>
          {requirement.requirement}
        </h4>
        {keyTerms && <KeyTermList keyTerms={keyTerms} quote={requirement.sourceQuote ?? ""} t={t} />}
        {requirement.note && (
          <p className="text-ed-body text-ed-ink-2">
            <Prose text={requirement.note} lines={1} />
          </p>
        )}
        {evidence && <CvQuote text={evidence} proof={claimed} caption={t("requirements.fromCv")} />}
        {onlyListed && <p className="text-ed-body text-ed-ink-2">{t("requirements.skillsOnly")}</p>}
        {onlyClaimed && <p className="text-ed-body text-ed-ink-2">{t("requirements.summaryOnly")}</p>}
      </div>
    </li>
  );
}

/**
 * "Ruby on Rails ✗ · MySQL ✓ · PostgreSQL ✓ (Postgres)", "C# ✓ or Python ✗", and the posting's examples on a line
 * of their own ("e.g. Azure ✗ · AWS ✗"): every term the posting names, and what the CV shows.
 */
function KeyTermList({ keyTerms, quote, t }: { keyTerms: KeyTerms; quote: string; t: AnalysisT }) {
  const { terms, examples } = termDisplay(keyTerms, quote);
  const list = "flex flex-wrap items-baseline gap-x-2 gap-y-1.5";

  return (
    <div className="grid gap-1.5 text-[15px] leading-[1.5]">
      {terms.length > 0 && (
        <ul aria-label={t("requirements.termsLabel")} className={list}>
          {terms.map((term, i) => (
            <TermItem key={`${term.term}-${i}`} term={term} t={t} />
          ))}
        </ul>
      )}
      {examples.length > 0 && (
        <ul aria-label={t("requirements.examplesLabel")} className={list}>
          <li className="text-ed-ink-3">{t("requirements.examplesLead")}</li>
          {examples.map((term, i) => (
            <TermItem key={`${term.term}-${i}`} term={term} t={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

// Spanish writes "u" for "o" before a word that starts with an o sound ("C# u Objective-C").
const STARTS_WITH_O = /^h?o/i;

function TermItem({ term, t }: { term: TermChip; t: AnalysisT }) {
  const same = term.cvMatch.toLowerCase() === term.term.trim().toLowerCase();
  return (
    <li className="inline-flex min-w-0 items-baseline gap-1 break-words">
      {term.joiner === "and" && (
        <span aria-hidden className="pr-1 text-ed-ink-3">
          ·
        </span>
      )}
      {term.joiner === "or" && (
        <span className="pr-1 text-ed-ink-3">{t(STARTS_WITH_O.test(term.term.trim()) ? "requirements.orBeforeO" : "requirements.or")}</span>
      )}
      <span className={term.shown ? "text-ed-ink" : "text-ed-ink-2"}>{term.term}</span>
      <TermMark shown={term.shown} />
      <span className="sr-only">{term.shown ? t("requirements.termShown") : t("requirements.termMissing")}</span>
      {term.shown && !same && <span className="text-ed-ink-3">({term.cvMatch})</span>}
    </li>
  );
}

/** ✓ in the signal colour (the CV shows it), ✗ in quiet ink: drawn, so the text stays the term and its reading. */
function TermMark({ shown }: { shown: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className={cn("size-3 flex-none self-center", shown ? "text-ed-signal" : "text-ed-ink-3")}>
      <path
        d={shown ? "M2.2 6.4 4.9 9 9.8 3.2" : "M3 3l6 6M9 3 3 9"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
