"use client";

import { FileText, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import type { ErrorCode } from "@/lib/error/errors";
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

/**
 * The CV as a side sheet. Native <dialog> gives the focus trap, Escape and the
 * top layer. The file's URL is signed when the sheet opens, and again for a
 * new tab, so a page left open for an hour still opens it; nothing holds a
 * URL across opens.
 */
export default function ResumeDrawer({ resumeId, title }: ResumeDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sheet, setSheet] = useState<Sheet>({ kind: "idle" });
  const [tabNotice, setTabNotice] = useState<string | null>(null);

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
    setTabNotice(null);
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
    setTabNotice(null);
    const url = await sign();
    if (!url) {
      popup?.close();
      return;
    }
    if (popup) popup.location.replace(url);
    else setTabNotice("The browser blocked the new tab. Allow pop-ups for this site and try again.");
  };

  return (
    <>
      <Button variant="outline" onClick={show} className="h-11 gap-2 px-5">
        <FileText className="size-4" />
        View CV
      </Button>

      <dialog
        ref={ref}
        aria-label="Your CV"
        className="drawer"
        onClose={() => setSheet({ kind: "idle" })}
        onClick={(event) => {
          // Only the backdrop closes; clicks inside the sheet don't reach here.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-6 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="eyebrow">Your CV</p>
              <p className="mt-1 truncate font-medium text-ink">{title}</p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <button
                type="button"
                onClick={openInNewTab}
                className="link-rule hidden cursor-pointer text-sm text-ink-2 sm:inline"
              >
                Open in new tab
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-paper-2"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {tabNotice && (
            <p role="status" className="border-b border-line px-5 py-3 text-sm text-signal sm:px-6">
              {tabNotice}
            </p>
          )}

          {sheet.kind === "loading" && (
            <p role="status" className="flex flex-1 items-center justify-center gap-3 text-sm text-ink-2">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Opening your CV.
            </p>
          )}

          {sheet.kind === "failed" && (
            <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <p className="text-ink">Couldn&apos;t open the CV. Try again.</p>
              <p className="max-w-sm text-sm text-ink-2">{actionErrorCopy(sheet.code)}</p>
              <Button variant="outline" onClick={load} className="h-10 px-4">
                Try again
              </Button>
            </div>
          )}

          {sheet.kind === "ready" && (
            <object
              data={`${sheet.url}#view=FitH`}
              type="application/pdf"
              aria-label="Resume PDF"
              className="w-full flex-1 bg-paper-2"
            >
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <p className="text-ink-2">
                  This browser can&apos;t display PDFs inline.
                </p>
                <button type="button" onClick={openInNewTab} className="link-rule cursor-pointer font-medium text-ink">
                  Open the PDF in a new tab
                </button>
              </div>
            </object>
          )}
        </div>
      </dialog>
    </>
  );
}
