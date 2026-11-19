import type { TFunction } from "i18next";
import { Plus } from "lucide-react";
import Prose from "@/components/i18n/Prose";
import { ordinal } from "@/lib/format";
import type { QuantifiedAchievement } from "@/lib/schemas/resumeSchema";
import { scoreTone, toneKey } from "@/lib/score";
import { cn } from "@/lib/utils";
import { CvQuote } from "./CvQuote";
import { ScoreBar } from "./ScoreBar";

/* Building blocks for the six report sections. Server components: the screen hands them its t. */

type AnalysisT = TFunction<"analysis">;

export const SUBHEAD = "text-h3 font-semibold text-ink";

type SectionProps = {
  id: string;
  index: string;
  total: string;
  label: string;
  /** `null` for the sections that report evidence instead of a number. */
  score: number | null;
  description: string;
  /** The common namespace: the score's accessible name and tone word. */
  common: TFunction<"common">;
  children: React.ReactNode;
};

export function Section({ id, index, total, label, score, description, common, children }: SectionProps) {
  return (
    // Scroll margin: the app header, plus the section strip on small screens.
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-36 border-t border-line-2 pt-8 pb-16 lg:scroll-mt-24 lg:pt-10">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
        <div className="min-w-0">
          <p aria-hidden className="mono text-[13px] text-ink-3">
            {index} / {total}
          </p>
          <h2 id={`${id}-title`} className="display mt-2 text-[clamp(30px,3.2vw,44px)] leading-[1.06] tracking-[-0.025em] text-balance">
            {label}
          </h2>
        </div>
        {score !== null && (
          <div className="w-full sm:w-60 sm:shrink-0">
            <p className="flex items-baseline justify-between gap-3">
              <span className="mono text-[40px] leading-none text-ink">{score}</span>
              <span className="text-[15px] text-ink-2">{common(toneKey("tone", scoreTone(score)))}</span>
            </p>
            <ScoreBar score={score} label={common("score.scoreOf", { label })} className="mt-3.5" />
          </div>
        )}
      </header>

      <p className="mt-6 max-w-[65ch] text-lede text-ink">
        <Prose text={description} lines={3} />
      </p>

      <div className="mt-10 grid gap-12">{children}</div>
    </section>
  );
}

type Mark = "strong" | "weak" | "neutral";

// Shape only, in ink: the heading above says what the list is; green stays for what the CV proves.
const MARKER: Record<Mark, string> = {
  strong: "mt-[0.6em] size-[7px] bg-ink",
  weak: "mt-[0.6em] size-[7px] border-[1.5px] border-ink-2",
  neutral: "mt-[0.78em] h-px w-2.5 bg-ink-3",
};

type MarkedListProps = {
  title: string;
  items: string[];
  mark: Mark;
};

/** Strengths get a filled square, problems an empty one, suggestions a dash. */
export function MarkedList({ title, items, mark }: MarkedListProps) {
  if (items.length === 0) return null;

  return (
    <div>
      <h3 className={SUBHEAD}>{title}</h3>
      <ul className="mt-4 grid gap-3.5">
        {items.map((item, i) => (
          <li key={i} className="grid grid-cols-[10px_minmax(0,1fr)] gap-x-3.5 text-body text-ink">
            <span aria-hidden className={cn("block", MARKER[mark])} />
            <span className="max-w-[65ch]">
              <Prose text={item} lines={1} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PAIR = "grid gap-x-gutter gap-y-10 md:grid-cols-2";

/** Two lists side by side from md up; one alone takes the full measure, none renders nothing. */
export function ListPair({ lists }: { lists: MarkedListProps[] }) {
  const shown = lists.filter((list) => list.items.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className={shown.length > 1 ? PAIR : undefined}>
      {shown.map((list) => (
        <MarkedList key={list.title} {...list} />
      ))}
    </div>
  );
}

export function NumberedList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <h3 className={SUBHEAD}>{title}</h3>
      <ol className="mt-4 border-t border-line">
        {items.map((item, i) => (
          <li key={i} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 border-b border-line py-4 text-body text-ink">
            <span aria-hidden className="mono pt-0.5 text-[13px] text-ink-3">
              {ordinal(i)}
            </span>
            <span className="max-w-[65ch]">
              <Prose text={item} lines={1} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** What an analysis leaned on. Collapsed by default: it backs the section up without competing with it. */
export function Evidence({ items, t }: { items: string[]; t: AnalysisT }) {
  if (items.length === 0) return null;

  return (
    <details className="group border-y border-line">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-body font-medium text-ink-2 transition-colors duration-200 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span>{t("sections.evidence", { n: items.length })}</span>
        <Plus data-marker aria-hidden className="size-4 flex-none transition-transform duration-[250ms] ease-out group-open:rotate-45" />
      </summary>
      <ul className="grid max-w-[68ch] gap-2.5 pt-1 pb-5">
        {items.map((item, i) => (
          <li key={i}>
            <CvQuote text={item} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Rewritten bullets for a role in the CV. They stay in the CV's language: never translated. */
export function Rewrites({ bullets, t }: { bullets: Array<{ role: string; examples: string[] }>; t: AnalysisT }) {
  const withExamples = bullets.filter((bullet) => bullet.examples.length > 0);
  if (withExamples.length === 0) return null;

  return (
    <div>
      <h3 className={SUBHEAD}>{t("sections.rewrites")}</h3>
      <div className="mt-5 grid gap-7">
        {withExamples.map((bullet, i) => (
          <div key={`${bullet.role}-${i}`} translate="no" className="max-w-[68ch]">
            <p className="text-body font-semibold text-ink">{bullet.role}</p>
            <ul className="mt-3 grid gap-3">
              {bullet.examples.map((example, j) => (
                <li key={j} className="border-l border-line-2 pl-4 text-body text-ink">
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

/** Skills the posting asks for, each with the CV line that proves it. */
export function SkillEvidence({ skills, t }: { skills: Array<{ name: string; evidence: string }>; t: AnalysisT }) {
  return (
    <div>
      <h3 className={SUBHEAD}>{t("sections.skillsProven")}</h3>
      {skills.length === 0 ? (
        <p className="mt-4 text-body text-ink-2">{t("sections.noSkillsProven")}</p>
      ) : (
        <dl className="mt-4 border-t border-line">
          {skills.map((skill, i) => (
            <div key={`${skill.name}-${i}`} className="grid gap-x-6 gap-y-2 border-b border-line py-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <dt className="text-body font-medium text-ink">{skill.name}</dt>
              <dd className="min-w-0 max-w-[68ch]">
                <CvQuote text={skill.evidence} proof />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The figures the CV already has. Empty is itself the finding. */
export function Achievements({ achievements, t }: { achievements: QuantifiedAchievement[]; t: AnalysisT }) {
  return (
    <div>
      <h3 className={SUBHEAD}>{t("sections.achievements")}</h3>
      {achievements.length === 0 ? (
        <p className="mt-4 text-body text-ink-2">{t("sections.noAchievements")}</p>
      ) : (
        <dl className="mt-4 border-t border-line">
          {achievements.map((achievement, i) => (
            <div key={i} className="grid gap-x-6 gap-y-2 border-b border-line py-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt translate="no" className="mono pt-1.5 text-[22px] leading-none text-ink">
                {achievement.figure}
              </dt>
              <dd className="min-w-0 max-w-[68ch]">
                <CvQuote text={achievement.quote} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * What the extracted text actually contains. This replaced the ATS score: the model is reliably right about the
 * artifacts and was filling the rest with advice the document did not need.
 */
export function TextLayer({ artifacts, sections, t }: { artifacts: string[]; sections: string[]; t: AnalysisT }) {
  return (
    <div className={PAIR}>
      <div>
        <h3 className={SUBHEAD}>{t("sections.artifacts")}</h3>
        {artifacts.length === 0 ? (
          <p className="mt-4 text-body text-ink-2">{t("sections.noArtifacts")}</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {artifacts.map((artifact, i) => (
              <li key={i} translate="no" className="mono rounded-kbd bg-raise px-3 py-2 text-[15px] break-words text-ink">
                {artifact}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className={SUBHEAD}>{t("sections.atsSections")}</h3>
        {sections.length === 0 ? (
          <p className="mt-4 text-body text-ink-2">{t("sections.noAtsSections")}</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {sections.map((section, i) => (
              <li key={`${section}-${i}`} translate="no" className="rounded-kbd border border-line-2 px-2.5 py-1 text-[15px] text-ink">
                {section}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
