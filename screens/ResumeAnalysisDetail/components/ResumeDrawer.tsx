"use client";

import { FileText, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass, textLinkClass } from "@/components/design-system/Button";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import type { ErrorCode } from "@/lib/error/errors";
import { cn } from "@/lib/utils";
import { getResumeViewUrlAction } from "@/screens/ResumeAnalysisDetail/actions/getResumeViewUrlAction";

type ResumeDrawerProps = {
  resumeId: string;
  title: string;
};

type Sheet =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "failed"; code: ErrorCode };

// A side sheet on a native <dialog>: pinned to the right edge at full height, it slides in on open and out on close
// (allow-discrete keeps it in the top layer while it leaves), over a dimmed page. Reduced motion: it simply appears.
const SHEET = [
  "fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(46rem,100vw)] max-w-none border-0 p-0",
  "bg-panel text-ink shadow-[-1px_0_0_var(--color-line-2),-24px_0_48px_-24px_rgb(0_0_0/0.8)]",
  "translate-x-full open:translate-x-0 starting:open:translate-x-full",
  "transition-[translate,overlay,display] transition-discrete duration-500 ease-out",
  "backdrop:bg-[rgb(0_0_0/0.62)] backdrop:opacity-0 open:backdrop:opacity-100 starting:open:backdrop:opacity-0",
  "backdrop:transition-[opacity,overlay,display] backdrop:transition-discrete backdrop:duration-500 backdrop:ease-out",
  "motion-reduce:transition-none motion-reduce:backdrop:transition-none",
].join(" ");

/**
 * The CV as a side sheet. Native <dialog> gives the focus trap, Escape and the
 * top layer. The file's URL is signed when the sheet opens, and again for a
 * new tab, so a page left open for an hour still opens it; nothing holds a
 * URL across opens.
 */
export default function ResumeDrawer({ resumeId, title }: ResumeDrawerProps) {
  const { t } = useTranslation("analysis");
  const errorCopy = useErrorCopy();
  const ref = useRef<HTMLDialogElement>(null);
  const [sheet, setSheet] = useState<Sheet>({ kind: "idle" });
  const [popupBlocked, setPopupBlocked] = useState(false);

  const sign = async (): Promise<string | null> => {
    try {
      const result = await getResumeViewUrlAction({ resumeId });
      if (result.ok) return result.data.url;
      setSheet({ kind: "failed", code: result.code });
    } catch {
      setSheet({ kind: "failed", code: "REQUEST_FAILED" });
    }
    return null;
  };

  const load = async () => {
    setSheet({ kind: "loading" });
    const url = await sign();
    if (url) setSheet({ kind: "ready", url });
  };

  const show = () => {
    setPopupBlocked(false);
    ref.current?.showModal();
    void load();
  };

  const close = () => {
    ref.current?.close();
    setSheet({ kind: "idle" });
  };

  const openInNewTab = async () => {
    // Opened inside the click, before the await, so the browser allows it.
    const popup = window.open("about:blank", "_blank");
    setPopupBlocked(false);
    const url = await sign();
    if (!url) {
      popup?.close();
      return;
    }
    if (popup) popup.location.replace(url);
    else setPopupBlocked(true);
  };

  return (
    <>
      <button type="button" onClick={show} className={buttonClass({ variant: "ghost" })}>
        <FileText aria-hidden className="size-4 flex-none" />
        {t("drawer.view")}
      </button>

      <dialog
        ref={ref}
        aria-label={t("drawer.title")}
        className={SHEET}
        onClose={() => setSheet({ kind: "idle" })}
        onClick={(event) => {
          // Only the backdrop closes; clicks inside the sheet don't reach here.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-6 border-b border-line px-5 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="cap">{t("drawer.title")}</p>
              <p data-truncate="drawer-title" className="mt-1 truncate text-body font-medium text-ink">
                {title}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button type="button" onClick={openInNewTab} className={cn(textLinkClass, "hidden sm:inline-flex")}>
                {t("drawer.openInNewTab")}
              </button>
              <button
                type="button"
                onClick={close}
                aria-label={t("drawer.close")}
                className="flex size-11 cursor-pointer items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-raise hover:text-ink"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
          </div>

          {popupBlocked && (
            <p role="status" className="border-b border-line px-5 py-3 text-[15px] text-ink sm:px-6">
              {t("drawer.popupBlocked")}
            </p>
          )}

          {sheet.kind === "loading" && (
            <p role="status" className="flex flex-1 items-center justify-center gap-3 text-body text-ink-2">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {t("drawer.opening")}
            </p>
          )}

          {sheet.kind === "failed" && (
            <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <p className="text-body text-ink">{t("drawer.failed")}</p>
              <p className="max-w-sm text-[15px] text-ink-2">{errorCopy(sheet.code)}</p>
              <button type="button" onClick={load} className={buttonClass({ variant: "ghost", size: "sm" })}>
                {t("drawer.tryAgain")}
              </button>
            </div>
          )}

          {sheet.kind === "ready" && (
            <object data={`${sheet.url}#view=FitH`} type="application/pdf" aria-label={t("drawer.pdfLabel")} className="w-full flex-1 bg-raise">
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <p className="text-body text-ink-2">{t("drawer.noInline")}</p>
                <button type="button" onClick={openInNewTab} className={buttonClass({ variant: "ghost", size: "sm" })}>
                  {t("drawer.openPdf")}
                </button>
              </div>
            </object>
          )}
        </div>
      </dialog>
    </>
  );
}
