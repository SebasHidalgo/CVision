import { Check, Plus, X } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import ScoreMeter from "@/components/score/ScoreMeter";
import { ordinal } from "@/lib/format";
import { scoreTone, TONE_CLASS, TONE_LABEL } from "@/lib/score";
import { cn } from "@/lib/utils";

/* Shared building blocks for the six dimension sections. */

type SectionProps = {
  id: string;
  index: string;
  label: string;
  score: number;
  description: string;
  children: React.ReactNode;
};

export function Section({
  id,
  index,
  label,
  score,
  description,
  children,
}: SectionProps) {
  const tone = scoreTone(score);

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
        <div className="flex w-full items-center gap-4 sm:w-72 sm:shrink-0">
          <span className="figure w-14 text-5xl text-ink tabular">{score}</span>
          <div className="min-w-0 flex-1">
            <ScoreMeter score={score} size="sm" label={`${label} score`} />
            <p className={cn("mt-1.5 text-xs font-medium", TONE_CLASS[tone].text)}>
              {TONE_LABEL[tone]}
            </p>
          </div>
        </div>
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
  emptyText?: string;
};

/** Keywords and skills as set type: ticked when found, marked when missing. */
export function Chips({ title, items, kind, emptyText }: ChipsProps) {
  return (
    <div>
      <h3 className="eyebrow">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">{emptyText ?? "None found."}</p>
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
};

/** Collapsed by default: it backs the verdict up without competing with it. */
export function Evidence({ items }: EvidenceProps) {
  if (items.length === 0) return null;

  return (
    <details className="details-reset border-t border-line pt-4">
      <summary className="flex items-center justify-between text-sm font-medium text-ink-2 transition-colors hover:text-ink">
        <span>What the analyzer relied on ({items.length})</span>
        <Plus data-marker aria-hidden className="size-4" />
      </summary>
      <ul className="mt-4 space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-2">
            <Marker mark="neutral" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

type RewritesProps = {
  bullets: Array<{ role: string; examples: string[] }>;
};

/** The pencil in the margin: rewritten bullets set against a signal rule. */
export function Rewrites({ bullets }: RewritesProps) {
  const withExamples = bullets.filter((bullet) => bullet.examples.length > 0);
  if (withExamples.length === 0) return null;

  return (
    <div>
      <h3 className="eyebrow">Suggested rewrites</h3>
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
};

export function SkillEvidence({ skills }: SkillEvidenceProps) {
  return (
    <div>
      <h3 className="eyebrow">Skills you prove</h3>
      {skills.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">
          None of the required skills is backed by evidence in the CV.
        </p>
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
              <dd className="text-sm leading-relaxed text-ink-2">{skill.evidence}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
