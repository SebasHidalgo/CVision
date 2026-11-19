"use client";

import { useTranslation } from "react-i18next";
import { StatusMark } from "@/components/design-system/StatusMark";
import type { RequirementId } from "@/screens/Home/utils/exampleCase";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { cn } from "@/lib/utils";
import { useFigure, useStoryCase } from "./figureContext";
import { clock, pad2, type StepId } from "./storyData";
import styles from "./Story.module.css";

/** Where a variant waits while it isn't current, on the moving object. */
type Slot = "overlay" | "foot" | "inline" | "right" | "below";

/** Text shown only at some steps. The moving object holds every variant and cross-fades them; a still draws only
 * its own step's. */
export function V({ at, slot, className, children }: { at: readonly StepId[]; slot?: Slot; className?: string; children: React.ReactNode }) {
  const { mode, step } = useFigure();
  const on = at.includes(step);
  if (mode === "still") return on ? <span className={className}>{children}</span> : null;
  return <span className={cn(styles.v, slot && styles[slot], on && styles.on, className)}>{children}</span>;
}

export const CAP = "mr-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3";

const lineRefClass = (proven: boolean) => cn("mono text-[13px]", proven ? "text-signal" : "text-ink-3");

/** "Node.js ✓ · PostgreSQL ✗ or MySQL ✗": the posting's terms, each found in the CV or not. */
function TermList({ groups }: { groups: LocalizedRequirement["terms"] }) {
  const { t } = useTranslation("landingStory");
  return (
    <span>
      {groups.map((group, gi) => (
        <span key={group[0]?.id ?? gi}>
          {gi > 0 && <span className="text-ink-3"> · </span>}
          {group.map((term, ti) => (
            <span key={term.id}>
              {ti > 0 && <span className="text-ink-3"> {t("figure.termOr")} </span>}
              <span className={term.found ? "text-signal" : undefined}>
                {term.name} {term.found ? "✓" : "✗"}
              </span>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/** One of the posting's requirements, in the state of the current step: the posting's words, its kind, the CV line
 * that proves it, its status, and how the interview went on it. */
export function ReqRow({ id }: { id: RequirementId }) {
  const { t } = useTranslation("landingStory");
  const { mode, step } = useFigure();
  const { requirements, cvLines, gaps } = useStoryCase();
  const r = requirements[id];
  const gap = gaps[id];
  const proven = r.line !== null && (r.status === "met" || r.status === "partial");
  const lineRef = r.line ? t("figure.lineRef", { n: pad2(r.line) }) : "—";

  return (
    <div
      className={cn(
        "grid content-start gap-1.5 border-t border-line",
        mode === "still" ? "py-[9px]" : step === "search" ? "pt-2" : "pt-[9px]",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3 max-[560px]:flex-wrap max-[560px]:gap-y-0.5">
        <span className="mono w-6 flex-none text-[13px] text-ink-3">{r.n}</span>
        <span className="relative grid min-w-0 flex-1 text-ink">
          <V at={["posting", "requirements"]} slot="inline">
            {r.text}.
          </V>
          <V at={["search", "verdict", "interview", "feedback"]} slot="inline">
            {r.label}
          </V>
        </span>
        <span className="relative grid flex-none justify-items-end text-[13.5px] text-ink-2 max-[560px]:basis-full max-[560px]:justify-items-start max-[560px]:pl-9">
          <V at={["requirements"]} slot="right" className="text-[13px] text-ink-3">
            {r.kindLabel}
          </V>
          {/* A still writes the proving line out under the row instead. */}
          {mode === "stage" && (
            <V at={["search"]} slot="right" className={lineRefClass(proven)}>
              {lineRef}
            </V>
          )}
          <V at={["verdict", "interview"]} slot="right" className="inline-flex items-center gap-[7px] whitespace-nowrap">
            <StatusMark status={r.status} /> {r.status === "notshown" ? r.statusShort : r.statusLabel}
          </V>
          {gap && (
            <V at={["feedback"]} slot="right" className="whitespace-nowrap rounded-full border border-line-2 px-2.5 py-px text-[13px] text-ink">
              {gap.outcome}
            </V>
          )}
        </span>
      </div>
      {id === "r1" && (
        <V at={["search"]} slot="below" className="mono pl-9 text-[13px] leading-[1.45] text-ink-2">
          {t("figure.yearsSum")}
        </V>
      )}
      {id === "r3" && (
        <V at={["search"]} slot="below" className="mono pl-9 text-[13px] leading-[1.45] text-ink-2">
          <TermList groups={r.terms} />
        </V>
      )}
      {gap && (
        <V at={["feedback"]} slot="below" className="pl-9 text-[15px] leading-[1.45] text-ink">
          <span className="mono mr-2.5 text-[13px] text-ink-3">{clock(gap.at)}</span>
          {t("figure.quote", { text: gap.quote })}
        </V>
      )}
      {mode === "still" && step === "search" && (
        <p className="pb-2.5 pl-9 text-[13.5px] text-ink-2">
          {r.line ? (
            <>
              <span className={lineRefClass(proven)}>{lineRef}</span>{" "}
              {t("figure.quote", { text: cvLines.find((l) => l.n === r.line)?.text ?? "" })}
            </>
          ) : (
            <span className="text-ink-3">{t("figure.noProof")}</span>
          )}
        </p>
      )}
    </div>
  );
}
