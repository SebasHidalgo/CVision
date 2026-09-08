"use client";

import { FileText, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type ResumeDrawerProps = {
  resumeUrl: string;
  title: string;
};

/**
 * The CV as a side sheet. Native <dialog> gives the focus trap, Escape and the
 * top layer; the PDF only mounts while open so it isn't fetched for nothing.
 */
export default function ResumeDrawer({ resumeUrl, title }: ResumeDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const show = () => {
    setOpen(true);
    ref.current?.showModal();
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
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // Only the backdrop closes; clicks inside the sheet don't reach here.
          if (event.target === event.currentTarget) ref.current?.close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-6 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="eyebrow">Your CV</p>
              <p className="mt-1 truncate font-medium text-ink">{title}</p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <a
                href={resumeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="link-rule hidden text-sm text-ink-2 sm:inline"
              >
                Open in new tab
              </a>
              <button
                type="button"
                onClick={() => ref.current?.close()}
                aria-label="Close"
                className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-paper-2"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {open && (
            <object
              data={`${resumeUrl}#view=FitH`}
              type="application/pdf"
              aria-label="Resume PDF"
              className="w-full flex-1 bg-paper-2"
            >
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <p className="text-ink-2">
                  This browser can&apos;t display PDFs inline.
                </p>
                <a
                  href={resumeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-rule font-medium text-ink"
                >
                  Open the PDF in a new tab
                </a>
              </div>
            </object>
          )}
        </div>
      </dialog>
    </>
  );
}
