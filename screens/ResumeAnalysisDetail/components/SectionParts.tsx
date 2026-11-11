import type { TFunction } from "i18next";
import { Check, Plus, X } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import ScoreMeter from "@/components/score/ScoreMeter";
import { termDisplay, type TermChip } from "@/lib/ai/requirementGuardrails";
import { ordinal } from "@/lib/format";
import type {
  KeyTerms,
  QuantifiedAchievement,
  Requirement,
  RequirementStatus,
  requirementTally,
} from "@/lib/schemas/resumeSchema";
import { scoreTone, TONE_CLASS, toneKey } from "@/lib/score";
import { cn } from "@/lib/utils";
import { displayQuote } from "../utils/displayQuote";

/* Shared building blocks for the six dimension sections. Server components: the screen hands them its t. */

type AnalysisT = TFunction<"analysis">;

type SectionProps = {
  id: string;
  index: string;
  label: string;
  /** `null` for the sections that report evidence instead of a number. */
  score: number | null;
  description: string;
  /** The common namespace: the score's accessible name and tone word. */
  common: TFunction<"common">;
  children: React.ReactNode;
};

export function Section({
  id,
  index,
  label,
  score,
  description,
  common,
  children,
}: SectionProps) {
  const tone = score === null ? null : scoreTone(score);

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-32 border-t border-line py-10 lg:scroll-mt-28 lg:py-14"
    >
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
        <div>
          <Eyebrow>
            {index} <span className="text-ink-3">/ 06</span>
          </Eyebrow>
          <h2 id={`${id}-title`} className="display-md mt-3 text-ink">
            {label}
          </h2>
        </div>
        {score !== null && tone && (
          <div className="flex w-full items-center gap-4 sm:w-72 sm:shrink-0">
            <span className="figure w-14 text-5xl text-ink tabular">{score}</span>
            <div className="min-w-0 flex-1">
              <ScoreMeter score={score} size="sm" label={common("score.scoreOf", { label })} />
              <p className={cn("mt-1.5 text-xs font-medium", TONE_CLASS[tone].text)}>
                {common(toneKey("tone", tone))}
              </p>
            </div>
          </div>
        )}
      </header>

      <p className="mt-7 max-w-2xl text-[17px] leading-relaxed text-ink-2">
        {description}
      </p>

      <div className="mt-9 space-y-10">{children}</div>
    </section>
  );
}

type Mark = "strong" | "signal" | "neutral";

function Marker({ mark }: { mark: Mark }) {
  if (mark === "strong") {
    return <Check aria-hidden className="mt-1 size-4 shrink-0 text-strong" />;
  }
  if (mark === "signal") {
    return <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 bg-signal" />;
  }
  return <span aria-hidden className="mt-[0.75em] h-px w-3 shrink-0 bg-ink-3" />;
}

type MarkedListProps = {
  title: string;
  items: string[];
  mark: Mark;
  className?: string;
};

/** Strengths get a check, problems get the red square, evidence a dash. */
export function MarkedList({ title, items, mark, className }: MarkedListProps) {
  if (items.length === 0) return null;

  return (
    <div className={className}>
      <h3 className="eyebrow">{title}</h3>
      <ul className="mt-4 space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink">
            <Marker mark={mark} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type NumberedListProps = {
  title: string;
  items: string[];
};

export function NumberedList({ title, items }: NumberedListProps) {
  if (items.length === 0) return null;

  return (
    <div>
      <h3 className="eyebrow">{title}</h3>
      <ol className="mt-4 divide-y divide-line border-y border-line">
        {items.map((item, i) => (
          <li
            key={i}
            className="grid grid-cols-[2.5rem_1fr] gap-x-3 py-3.5 text-[15px] leading-relaxed text-ink"
          >
            <span className="eyebrow pt-1 text-ink">{ordinal(i)}</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

type ChipsProps = {
  title: string;
  items: string[];
  kind: "matched" | "missing" | "neutral";
  emptyText: string;
};

/** Keywords and skills as set type: ticked when found, marked when missing. */
export function Chips({ title, items, kind, emptyText }: ChipsProps) {
  return (
    <div>
      <h3 className="eyebrow">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">{emptyText}</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {items.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className={cn(
                "inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[12px] text-ink",
                kind === "matched" && "border-strong/40",
                kind === "missing" && "border-signal/45",
                kind === "neutral" && "border-line-strong",
              )}
            >
              {kind === "matched" && <Check aria-hidden className="size-3 text-strong" />}
              {kind === "missing" && <X aria-hidden className="size-3 text-signal" />}
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type EvidenceProps = {
  items: string[];
  t: AnalysisT;
};

/** Collapsed by default: it backs the verdict up without competing with it. */
export function Evidence({ items, t }: EvidenceProps) {
  if (items.length === 0) return null;

  return (
    <details className="details-reset border-t border-line pt-4">
      <summary className="flex items-center justify-between text-sm font-medium text-ink-2 transition-colors hover:text-ink">
        <span>{t("sections.evidence", { n: items.length })}</span>
        <Plus data-marker aria-hidden className="size-4" />
      </summary>
      <ul className="mt-4 space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-2">
            <Marker mark="neutral" />
            <span>{displayQuote(item)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

type RewritesProps = {
  bullets: Array<{ role: string; examples: string[] }>;
  t: AnalysisT;
};

/** The pencil in the margin: rewritten bullets set against a signal rule. */
export function Rewrites({ bullets, t }: RewritesProps) {
  const withExamples = bullets.filter((bullet) => bullet.examples.length > 0);
  if (withExamples.length === 0) return null;

  return (
    <div>
      <h3 className="eyebrow">{t("sections.rewrites")}</h3>
      <div className="mt-4 space-y-6">
        {withExamples.map((bullet, i) => (
          <div key={`${bullet.role}-${i}`}>
            <p className="font-medium text-ink">{bullet.role}</p>
            <ul className="mt-2.5 space-y-2.5">
              {bullet.examples.map((example, j) => (
                <li
                  key={j}
                  className="border-l-2 border-signal pl-4 text-[15px] leading-relaxed text-ink"
                >
                  {example}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

type SkillEvidenceProps = {
  skills: Array<{ name: string; evidence: string }>;
  t: AnalysisT;
};

export function SkillEvidence({ skills, t }: SkillEvidenceProps) {
  return (
    <div>
      <h3 className="eyebrow">{t("sections.skillsProven")}</h3>
      {skills.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">{t("sections.noSkillsProven")}</p>
      ) : (
        <dl className="mt-4 divide-y divide-line border-y border-line">
          {skills.map((skill, i) => (
            <div
              key={`${skill.name}-${i}`}
              className="grid gap-1.5 py-3.5 sm:grid-cols-[11rem_1fr] sm:gap-6"
            >
              <dt className="flex items-center gap-2 font-medium text-ink">
                <Check aria-hidden className="size-4 shrink-0 text-strong" />
                {skill.name}
              </dt>
              <dd className="text-sm leading-relaxed text-ink-2">{displayQuote(skill.evidence)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

type RequirementsProps = {
  requirements: Requirement[];
  tally: ReturnType<typeof requirementTally>;
  t: AnalysisT;
};

const STATUS_MARK: Record<RequirementStatus, Mark> = {
  met: "strong",
  partial: "neutral",
  missing: "signal",
  not_evident: "neutral",
};

/**
 * The headline of the analysis: one row per requirement in the posting. A
 * plain list on purpose - the shape is what this phase is testing, and a
 * visual pass on it comes later.
 */
export function Requirements({ requirements, tally, t }: RequirementsProps) {
  const groups = [
    { kind: "required" as const, title: t("requirements.requiredTitle"), count: tally.required },
    { kind: "preferred" as const, title: t("requirements.preferredTitle"), count: tally.preferred },
  ];
  const notShown = requirements.filter((requirement) => requirement.status === "not_evident");

  if (requirements.length === 0) {
    return <p className="text-sm text-ink-3">{t("requirements.none")}</p>;
  }

  return (
    <div className="space-y-10">
      {groups.map(({ kind, title, count }) => {
        const rows = requirements.filter(
          (requirement) => requirement.kind === kind && requirement.status !== "not_evident",
        );
        if (rows.length === 0) return null;

        return (
          <div key={kind}>
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="eyebrow">{title}</h3>
              <p className="text-sm text-ink-2 tabular">
                {count.partial > 0
                  ? t("requirements.countWithPartial", { met: count.met, total: count.total, partial: count.partial })
                  : t("requirements.count", { met: count.met, total: count.total })}
              </p>
            </div>

            <ul className="mt-4 divide-y divide-line border-y border-line">
              {rows.map((requirement, i) => (
                <RequirementRow
                  key={i}
                  requirement={requirement}
                  label={t(`status.${requirement.status}`)}
                  t={t}
                />
              ))}
            </ul>
          </div>
        );
      })}

      {notShown.length > 0 && (
        <div>
          <h3 className="eyebrow">{t("status.not_evident")}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">{t("requirements.notShownAdvice")}</p>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {notShown.map((requirement, i) => (
              <RequirementRow
                key={i}
                requirement={requirement}
                label={t(`kind.${requirement.kind}`)}
                t={t}
              />
            ))}
          </ul>
        </div>
      )}
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
    <li className="py-4">
      <div className="flex gap-3">
        <Marker mark={STATUS_MARK[requirement.status]} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-relaxed text-ink">{requirement.requirement}</p>
          <p className="eyebrow mt-1.5 text-ink-3">{label}</p>
          {keyTerms && <KeyTermList keyTerms={keyTerms} quote={requirement.sourceQuote ?? ""} t={t} />}
          {requirement.note && (
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{requirement.note}</p>
          )}
          {evidence && (
            <p className="mt-2 border-l-2 border-line-strong pl-3 font-mono text-[12px] leading-relaxed text-ink-2">
              {displayQuote(evidence)}
            </p>
          )}
          {onlyListed && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{t("requirements.skillsOnly")}</p>}
          {onlyClaimed && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{t("requirements.summaryOnly")}</p>}
        </div>
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

  return (
    <div className="mt-2 space-y-1 text-[13px] text-ink-2">
      {terms.length > 0 && (
        <ul aria-label={t("requirements.termsLabel")} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {terms.map((term, i) => (
            <TermItem key={`${term.term}-${i}`} term={term} t={t} />
          ))}
        </ul>
      )}
      {examples.length > 0 && (
        <ul aria-label={t("requirements.examplesLabel")} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <li className="text-ink-3">{t("requirements.examplesLead")}</li>
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
    <li className="inline-flex items-center gap-1">
      {term.joiner === "and" && <span aria-hidden className="pr-0.5 text-ink-3">·</span>}
      {term.joiner === "or" && (
        <span className="pr-0.5 text-ink-3">
          {t(STARTS_WITH_O.test(term.term.trim()) ? "requirements.orBeforeO" : "requirements.or")}
        </span>
      )}
      <span className="text-ink">{term.term}</span>
      {term.shown ? <Check aria-hidden className="size-3.5 text-strong" /> : <X aria-hidden className="size-3.5 text-signal" />}
      <span className="sr-only">{term.shown ? t("requirements.termShown") : t("requirements.termMissing")}</span>
      {term.shown && !same && <span className="text-ink-3">({term.cvMatch})</span>}
    </li>
  );
}

type AchievementsProps = {
  achievements: QuantifiedAchievement[];
  t: AnalysisT;
};

/** The figures the CV already has. Empty is itself the finding. */
export function Achievements({ achievements, t }: AchievementsProps) {
  return (
    <div>
      <h3 className="eyebrow">{t("sections.achievements")}</h3>
      {achievements.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">{t("sections.noAchievements")}</p>
      ) : (
        <dl className="mt-4 divide-y divide-line border-y border-line">
          {achievements.map((achievement, i) => (
            <div
              key={i}
              className="grid gap-1.5 py-3.5 sm:grid-cols-[6rem_1fr] sm:gap-6"
            >
              <dt className="figure text-2xl text-ink tabular">
                {achievement.figure}
              </dt>
              <dd className="font-mono text-[12px] leading-relaxed text-ink-2">
                {displayQuote(achievement.quote)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

type TextLayerProps = {
  artifacts: string[];
  sections: string[];
  t: AnalysisT;
};

/**
 * What the extracted text actually contains. This replaced the ATS score: the
 * model is reliably right about the artifacts and was filling the rest with
 * advice the document did not need.
 */
export function TextLayer({ artifacts, sections, t }: TextLayerProps) {
  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div>
        <h3 className="eyebrow">{t("sections.artifacts")}</h3>
        {artifacts.length === 0 ? (
          <p className="mt-4 text-sm text-ink-3">{t("sections.noArtifacts")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {artifacts.map((artifact, i) => (
              <li
                key={i}
                className="border-l-2 border-signal pl-3 font-mono text-[13px] leading-relaxed text-ink"
              >
                {artifact}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Chips
        title={t("sections.atsSections")}
        items={sections}
        kind="matched"
        emptyText={t("sections.noAtsSections")}
      />
    </div>
  );
}
