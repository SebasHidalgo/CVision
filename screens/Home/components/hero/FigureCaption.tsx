"use client";

import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";

type Props = {
  requirements: LocalizedRequirement[];
  role: string;
  company: string;
  /** The requirement stressed in the figure, if any: the caption reads it out. */
  focused: LocalizedRequirement | null;
  /** Null hides the replay (under reduced motion there is nothing to replay). */
  onReplay: (() => void) | null;
};

const count = (reqs: LocalizedRequirement[], status: LocalizedRequirement["status"]) => reqs.filter((r) => r.status === status).length;

/** Under the figure: what it shows (or the stressed requirement in full), and the replay. */
export function FigureCaption({ requirements, role, company, focused, onReplay }: Props) {
  const { t } = useTranslation("landingHero");
  return (
    <div className="flex flex-none flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-2.5">
      <p aria-live="polite" className="min-h-[2.8em] max-w-[92ch] text-[13.5px] text-ink-2">
        {focused ? (
          <>
            <span className="mono text-[12px]">{focused.n}</span>{" "}
            {focused.evidence
              ? t("caption.withEvidence", { text: focused.text, evidence: focused.evidence, note: focused.note })
              : t("caption.withoutEvidence", { text: focused.text, note: focused.note })}
          </>
        ) : (
          <>
            <span className="mono text-[12px]">
              {t("caption.fig")}
            </span>{" "}
            {t("caption.summary", {
              role,
              company,
              met: t("caption.met", { count: count(requirements, "met") }),
              partial: t("caption.partial", { count: count(requirements, "partial") }),
              missing: t("caption.missing", { count: count(requirements, "missing") }),
              notshown: t("caption.notshown", { count: count(requirements, "notshown") }),
            })}
          </>
        )}
      </p>
      {onReplay && (
        <button
          type="button"
          onClick={onReplay}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 px-1 text-[14.5px] font-medium text-ink transition-transform duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
        >
          <RotateCcw aria-hidden className="size-4" strokeWidth={1.75} />
          {t("caption.replay")}
        </button>
      )}
    </div>
  );
}
