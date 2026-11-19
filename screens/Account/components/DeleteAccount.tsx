"use client";

import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/components/design-system/Button";
import { ConfirmDialog } from "@/components/design-system/ConfirmDialog";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { deleteAccountAction } from "../actions/deleteAccountAction";

/** If signing out has not left the page by then (Clerk hung, or refused a session already gone), go home by hand. */
export const LEAVE_FALLBACK_MS = 6_000;

/**
 * The account's delete: a confirmation that names what goes, the action, then sign-out and home. A refusal stays
 * here, under the button, in words; the account is whole after one. After a deletion the button gives way to a
 * status line and the client session ends; a deleted Clerk user's session is already revoked, so a sign-out that
 * fails or hangs still ends in a full load of the home page.
 */
export default function DeleteAccount({ subscribed }: { subscribed: boolean }) {
  const { t } = useTranslation("account");
  const errorCopy = useErrorCopy();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const outcome = useRef<HTMLParagraphElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fallback = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (fallback.current !== null) window.clearTimeout(fallback.current);
    },
    [],
  );

  const leave = async () => {
    fallback.current = window.setTimeout(() => window.location.assign("/"), LEAVE_FALLBACK_MS);
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      window.location.assign("/");
    }
  };

  const confirm = async () => {
    setPending(true);
    setProblem(null);
    let failure: string | null = null;
    try {
      const result = await deleteAccountAction({ confirm: true });
      if (!result.ok) failure = errorCopy(result.code, result.meta);
    } catch {
      failure = errorCopy("REQUEST_FAILED");
    }
    setPending(false);
    setOpen(false);
    if (failure) {
      setProblem(failure);
      return;
    }
    setDone(true);
    void leave();
  };

  return (
    <div data-delete-account>
      {done ? (
        <p ref={outcome} tabIndex={-1} role="status" className="text-body font-medium text-ink">
          {t("overview.delete.done")}
        </p>
      ) : (
        <button
          ref={trigger}
          type="button"
          onClick={() => {
            setProblem(null);
            setOpen(true);
          }}
          className={buttonClass({
            variant: "ghost",
            size: "sm",
            className: "border-danger-text/60 text-danger-text hover:border-danger-text",
          })}
        >
          {t("overview.delete.action")}
        </button>
      )}
      {problem && (
        <p ref={outcome} tabIndex={-1} role="alert" className="mt-4 max-w-[62ch] text-body text-danger-text">
          {problem}
        </p>
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("overview.delete.confirmTitle")}
        body={t(subscribed ? "overview.delete.confirmBodySubscribed" : "overview.delete.confirmBody")}
        confirmLabel={t("overview.delete.confirm")}
        cancelLabel={t("overview.delete.cancel")}
        pendingLabel={t("overview.delete.deleting")}
        pending={pending}
        onConfirm={confirm}
        onCloseAutoFocus={(event) => {
          // After an outcome, focus goes to its line (the button is gone after a deletion); after a cancel, back to the button.
          const target = outcome.current ?? trigger.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      />
    </div>
  );
}
