"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusMark } from "@/components/design-system/StatusMark";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { KeyTerms } from "./KeyTerms";

/** Shared by the column header and each row: one grid, six columns from 1100 px, a stacked row below. */
export const ROW_GRID =
  "grid grid-cols-[34px_minmax(0,1fr)_20px] gap-x-4 gap-y-1.5 items-baseline " +
  "[grid-template-areas:'n_text_chev'_'n_status_.'_'n_ev_.'_'n_kind_.'] " +
  "min-[1100px]:grid-cols-[40px_minmax(0,2.3fr)_96px_170px_minmax(0,2.6fr)_20px] min-[1100px]:gap-y-0 " +
  "min-[1100px]:[grid-template-areas:'n_text_kind_status_ev_chev']";

/**
 * One requirement: the whole row is the button. The note and the key terms are always in the DOM; the panel's
 * row animates 0fr to 1fr, and once closed it is visibility: hidden, out of the accessibility tree.
 */
export function RequirementRow({ requirement: r }: { requirement: LocalizedRequirement }) {
  const { t } = useTranslation("landingAnalysis");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li data-open={open || undefined} className="group/req border-b border-ed-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`${ROW_GRID} -mx-3 w-[calc(100%+24px)] cursor-pointer rounded-ed-field px-3 py-4 text-left transition-colors duration-150 hover:bg-ed-raise motion-reduce:transition-none`}
      >
        <span className="ed-mono text-[13px] text-ed-ink-3 [grid-area:n]">{r.n}</span>
        <span className="font-medium [grid-area:text]">{r.text}</span>
        <span className="text-[14px] text-ed-ink-2 [grid-area:kind]">{r.kindLabel}</span>
        <span className="inline-flex items-center gap-2 text-[14.5px] [grid-area:status]">
          <StatusMark status={r.status} />
          {r.statusLabel}
        </span>
        <span className="text-[14.5px] text-ed-ink-2 [grid-area:ev]">
          {r.line && r.evidence ? (
            <>
              <span aria-hidden className="ed-mono mr-1 text-[12.5px] text-ed-ink-3">
                {t("requirements.line", { line: String(r.line).padStart(2, "0") })}
              </span>
              <span className="sr-only">{t("requirements.lineSr", { n: r.line })} </span>
              {t("requirements.quote", { text: r.evidence })}
            </>
          ) : (
            <span className="text-ed-ink-3">{t("requirements.noLine")}</span>
          )}
        </span>
        <span aria-hidden className="self-center text-ed-ink-3 [grid-area:chev]">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            className="transition-transform duration-[var(--ed-dur-quick)] ease-ed-out group-data-[open]/req:rotate-180 motion-reduce:transition-none"
          >
            <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      </button>
      <div
        id={panelId}
        className="invisible grid grid-rows-[0fr] [transition:grid-template-rows_320ms_var(--ease-ed-settle),visibility_0s_linear_320ms] group-data-[open]/req:visible group-data-[open]/req:grid-rows-[1fr] group-data-[open]/req:[transition:grid-template-rows_320ms_var(--ease-ed-settle),visibility_0s_linear_0s] motion-reduce:transition-none!"
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid max-w-[80ch] gap-2.5 pb-[18px] pl-[50px] text-[15px] text-ed-ink-2 min-[1100px]:pl-14">
            <p>{r.note}</p>
            {r.terms.length > 0 && <KeyTerms groups={r.terms} />}
          </div>
        </div>
      </div>
    </li>
  );
}
