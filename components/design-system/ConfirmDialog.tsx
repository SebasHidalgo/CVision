"use client";

import { useRef } from "react";
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
 * button first) without the shadcn skin. It portals to <body>, outside the page's `.ed-root`, so it carries the root
 * class and the text face itself.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  pending,
  onConfirm,
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  // Controlled without a Radix Trigger, Radix has nowhere to return focus: remember what had it.
  const returnTo = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-ed-fade motion-reduce:animate-none" />
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
            "ed-root ed-surface fixed top-1/2 left-1/2 z-50 grid w-[min(calc(100%-32px),30rem)] -translate-x-1/2 -translate-y-1/2 gap-4 p-6 max-sm:p-5",
            "data-[state=open]:animate-ed-fade motion-reduce:animate-none",
            fontText.variable,
          )}
        >
          <AlertDialog.Title className="text-ed-h3 font-semibold text-balance text-ed-ink">{title}</AlertDialog.Title>
          <AlertDialog.Description className="max-w-[60ch] text-ed-body text-ed-ink-2">{body}</AlertDialog.Description>
          <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
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
