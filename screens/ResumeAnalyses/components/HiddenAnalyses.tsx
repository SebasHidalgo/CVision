"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass, textLinkClass } from "@/components/design-system/Button";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { deleteHiddenAnalysesAction } from "@/screens/ResumeAnalyses/actions/deleteHiddenAnalysesAction";
import { deleteOneAnalysisAction } from "@/screens/ResumeAnalyses/actions/deleteOneAnalysisAction";
import { deletionSummary } from "@/screens/ResumeAnalyses/utils/deletionSummary";
import { ConfirmDialog } from "./ConfirmDialog";

/** One hidden analysis as the list shows it: told apart, never opened. Dates come formatted from the server. */
export type HiddenItem = {
  id: string;
  /** Its place in the whole history ("04"), continuing the visible list's numbering. */
  n: string;
  jobTitle: string;
  companyName: string;
  date: string;
  dateTime: string;
};

type Target = { kind: "all" } | { kind: "one"; item: HiddenItem };

/**
 * The analyses Free's history rule hides: how many, why, and the only way to delete them (their pages show the
 * upgrade notice). Always mounted, even with nothing hidden, so the outcome line survives deleting the last one;
 * after any outcome focus moves to that line, since the button that opened the dialog may be gone.
 */
export function HiddenAnalyses({ items, limit }: { items: HiddenItem[]; limit: number }) {
  const { t } = useTranslation("analyses");
  const errorCopy = useErrorCopy();
  const [target, setTarget] = useState<Target | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const focusOutcome = useRef(false);

  const confirm = async () => {
    if (!target) return;
    setPending(true);
    let text: string;
    try {
      if (target.kind === "one") {
        const { item } = target;
        const result = await deleteOneAnalysisAction({ resumeId: item.id });
        text = result.ok ? t("result.deletedOne", { jobTitle: item.jobTitle, companyName: item.companyName }) : errorCopy(result.code, result.meta);
      } else {
        const result = await deleteHiddenAnalysesAction({ ids: items.map((item) => item.id) });
        text = result.ok
          ? deletionSummary(result.data).map((part) => ("count" in part ? t(part.key, { count: part.count }) : t(part.key))).join(" ")
          : errorCopy(result.code, result.meta);
      }
    } catch {
      text = errorCopy("REQUEST_FAILED");
    }
    focusOutcome.current = true;
    setOutcome(text);
    setPending(false);
    setTarget(null);
  };

  const dialog =
    target?.kind === "one"
      ? {
          title: t("confirm.oneTitle"),
          body: t("confirm.oneBody", { jobTitle: target.item.jobTitle, companyName: target.item.companyName, date: target.item.date }),
          confirmLabel: t("confirm.oneConfirm"),
          cancelLabel: t("confirm.keep"),
        }
      : {
          title: t("confirm.allTitle", { count: items.length }),
          body: t("confirm.allBody", { limit }),
          confirmLabel: t("confirm.allConfirm", { count: items.length }),
          cancelLabel: t("confirm.keepAll"),
        };

  return (
    <div>
      <p ref={outcomeRef} tabIndex={-1} data-deletion-outcome className="mt-8 w-fit max-w-[75ch] rounded-ed-field border border-ed-line-2 bg-ed-panel px-4 py-3 text-ed-body text-ed-ink empty:hidden">
        {outcome}
      </p>

      {items.length > 0 && (
        <section data-hidden-analyses aria-labelledby="hidden-analyses-title" className="ed-surface mt-8 border-dashed px-6 pt-6 pb-2 max-sm:px-4">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <h2 id="hidden-analyses-title" className="text-ed-h3 font-semibold text-balance text-ed-ink">
                {t("hidden.title", { count: items.length })}
              </h2>
              <p className="mt-2 max-w-[68ch] text-ed-body text-ed-ink-2">{t("hidden.why", { limit })}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <button type="button" onClick={() => setTarget({ kind: "all" })} className={buttonClass({ variant: "ghost", size: "sm" })}>
                {t("hidden.deleteAll", { count: items.length })}
              </button>
              <Link href="/pricing" className={textLinkClass}>
                {t("hidden.seePro")}
              </Link>
            </div>
          </div>

          <ol aria-label={t("hidden.listLabel")} className="mt-6">
            {items.map((item) => (
              <li
                key={item.id}
                data-hidden-analysis
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-ed-line py-3 sm:grid-cols-[40px_minmax(0,1fr)_9rem_auto] sm:gap-x-5"
              >
                <span aria-hidden className="ed-mono row-span-2 self-start pt-0.5 text-[13px] text-ed-ink-3 sm:row-span-1 sm:self-center sm:pt-0">
                  {item.n}
                </span>
                <p className="min-w-0 break-words">
                  <span className="font-medium text-ed-ink">{item.companyName}</span>
                  <span className="block text-ed-small text-ed-ink-2">{item.jobTitle}</span>
                </p>
                <time dateTime={item.dateTime} className="ed-mono col-start-2 row-start-2 text-[13.5px] text-ed-ink-2 sm:col-start-auto sm:row-start-auto">
                  {item.date}
                </time>
                <button
                  type="button"
                  onClick={() => setTarget({ kind: "one", item })}
                  aria-label={t("row.deleteLabel", { jobTitle: item.jobTitle, companyName: item.companyName, date: item.date })}
                  className={buttonClass({ variant: "ghost", size: "sm", className: "col-start-3 row-span-2 row-start-1 sm:col-start-auto sm:row-span-1 sm:row-start-auto" })}
                >
                  {t("row.delete")}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        {...dialog}
        pendingLabel={t("confirm.deleting")}
        pending={pending}
        onConfirm={confirm}
        onCloseAutoFocus={(event) => {
          if (!focusOutcome.current) return;
          focusOutcome.current = false;
          event.preventDefault();
          outcomeRef.current?.focus();
        }}
      />
    </div>
  );
}
