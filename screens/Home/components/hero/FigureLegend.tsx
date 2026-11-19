"use client";

import { useTranslation } from "react-i18next";
import { StatusMark } from "@/components/design-system/StatusMark";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { cn } from "@/lib/utils";

type Props = {
  requirements: LocalizedRequirement[];
  pinned: string | null;
  /** Hover and keyboard focus stress a requirement for as long as they last; a click pins it. */
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
  loaderTarget: boolean;
  className?: string;
};

/** The desktop figure's legend: the six requirements with their status and CV line, and the figure's controls. */
export function FigureLegend({ requirements, pinned, onHover, onPin, loaderTarget, className }: Props) {
  const { t } = useTranslation("landingHero");
  return (
    <ul
      aria-label={t("figure.listLabel")}
      data-loader-target={loaderTarget ? "" : undefined}
      className={cn("surface mt-1.5 grid grid-cols-6 px-3.5", className)}
    >
      {requirements.map((r, i) => (
        <li key={r.id} className="flex">
          <button
            type="button"
            aria-pressed={pinned === r.id}
            onMouseEnter={() => onHover(r.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(r.id)}
            onBlur={() => onHover(null)}
            onClick={() => onPin(r.id)}
            className="grid w-full cursor-pointer content-start gap-1 border-t-2 border-transparent pt-2.5 pr-2.5 pb-3 pl-1 text-left transition-[border-color] duration-200 hover:border-ink aria-pressed:border-ink motion-reduce:transition-none"
          >
            <span className="flex flex-wrap items-center gap-[7px] text-[13px] text-ink-2">
              <span className="mono text-[12px] text-ink-3">{r.n}</span>
              <span data-loader-mark={i} className="inline-flex">
                <StatusMark status={r.status} />
              </span>
              <span aria-hidden>{r.statusShort}</span>
              <span className="sr-only">{`${r.statusLabel}, `}</span>
              <span className="mono ml-auto text-[12px] text-ink-3">
                {r.line ? (
                  <>
                    <span aria-hidden>{t("figure.line", { line: String(r.line).padStart(2, "0") })}</span>
                    <span className="sr-only">{`${t("figure.lineSr", { line: r.line })}, `}</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden>{"—"}</span>
                    <span className="sr-only">{`${t("figure.noLineSr")}, `}</span>
                  </>
                )}
              </span>
            </span>
            <span className="text-[14.5px] leading-[1.3] font-medium text-ink">{r.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
