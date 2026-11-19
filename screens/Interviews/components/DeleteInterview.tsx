"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { buttonClass } from "@/components/design-system/Button";
import { ConfirmDialog } from "@/components/design-system/ConfirmDialog";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { deleteOneInterviewAction } from "@/screens/Interviews/actions/deleteOneInterviewAction";

/** The row's words, rendered on the server with the row's role, company and date: no namespace travels to the client. */
export type DeleteInterviewCopy = {
  button: string;
  label: string;
  title: string;
  body: string;
  confirm: string;
  keep: string;
  deleting: string;
  deleted: string;
};

type DeleteInterviewProps = {
  interviewId: string;
  copy: DeleteInterviewCopy;
  /** The page heading's id: focus goes there once the row is gone. */
  returnFocusTo: string;
};

/**
 * Delete for one interview of the list: its transcript, feedback and calls at the voice platform; its analysis stays.
 * Outcomes are toasts, as for an analysis: on success the row (and this button) goes away with the list's refresh.
 */
export function DeleteInterview({ interviewId, copy, returnFocusTo }: DeleteInterviewProps) {
  const errorCopy = useErrorCopy();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const deleted = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const confirm = async () => {
    setPending(true);
    try {
      const result = await deleteOneInterviewAction({ interviewId });
      if (result.ok) {
        deleted.current = true;
        toast.success(copy.deleted);
      } else {
        toast.error(errorCopy(result.code, result.meta));
      }
    } catch {
      toast.error(errorCopy("REQUEST_FAILED"));
    }
    setPending(false);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy.label}
        className={buttonClass({ variant: "ghost", size: "sm" })}
      >
        {copy.button}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.confirm}
        cancelLabel={copy.keep}
        pendingLabel={copy.deleting}
        pending={pending}
        onConfirm={confirm}
        onCloseAutoFocus={(event) => {
          // Deleted: the row and this button are going, so the heading. Otherwise back to the button.
          const target = deleted.current ? document.getElementById(returnFocusTo) : trigger.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      />
    </>
  );
}
