"use client";

import { useCallback, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { buttonClass } from "@/components/design-system/Button";
import { fontText } from "@/components/design-system/fonts";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  open: boolean;
  /** Ignored while `pending`: a running deletion can't be dismissed half way. */
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  /** A second paragraph under the body, for a consequence that depends on the case (a date, a count). */
  note?: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  pending: boolean;
  onConfirm: () => void;
  /** Where focus goes when the dialog closes; otherwise back to what had it when the dialog opened. */
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * A destructive confirmation on the design system. Radix's alert dialog (focus trap, Escape, focus on the cancel
 * button first) without the shadcn skin. It portals to <body>, outside the page's `.root`, so it carries the root
 * class and the text face itself. It never grows past the viewport: on a short phone the body scrolls on its own
 * and the title and the actions stay in view.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  note,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  pending,
  onConfirm,
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  // Controlled without a Radix Trigger, Radix has nowhere to return focus: remember what had it.
  const returnTo = useRef<HTMLElement | null>(null);
  // A body that scrolls is a tab stop, so a keyboard can scroll it too; one that fits adds none.
  const [scrolls, setScrolls] = useState(false);
  const trackOverflow = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const update = () => setScrolls(node.scrollHeight > node.clientHeight + 1);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-fade motion-reduce:animate-none" />
        <AlertDialog.Content
          onOpenAutoFocus={() => {
            returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={
            onCloseAutoFocus ??
            ((event) => {
              if (!returnTo.current?.isConnected) return;
              event.preventDefault();
              returnTo.current.focus();
            })
          }
          className={cn(
            "root surface fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(calc(100%-32px),30rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 p-6 max-sm:p-5",
            "data-[state=open]:animate-fade motion-reduce:animate-none",
            fontText.variable,
          )}
        >
          <AlertDialog.Title className="flex-none text-h3 font-semibold text-balance text-ink">{title}</AlertDialog.Title>
          {/* The only part that shrinks: min-h-0 lets it scroll instead of pushing the actions out of the viewport. */}
          <div ref={trackOverflow} data-confirm-body tabIndex={scrolls ? 0 : undefined} className="min-h-0 overflow-y-auto overscroll-contain">
            <AlertDialog.Description asChild>
              <div className="grid max-w-[60ch] gap-3 text-body text-ink-2">
                <p>{body}</p>
                {note && (
                  <p data-confirm-note className="text-ink">
                    {note}
                  </p>
                )}
              </div>
            </AlertDialog.Description>
          </div>
          <div data-confirm-actions className="mt-2 flex flex-none flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel disabled={pending} className={buttonClass({ variant: "ghost", size: "sm" })}>
              {cancelLabel}
            </AlertDialog.Cancel>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              aria-busy={pending || undefined}
              className={buttonClass({ size: "sm", className: "disabled:cursor-progress disabled:opacity-80" })}
            >
              {pending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
