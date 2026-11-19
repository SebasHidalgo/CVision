"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { buttonClass } from "@/components/design-system/Button";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { deleteOneAnalysisAction } from "@/screens/ResumeAnalyses/actions/deleteOneAnalysisAction";
import { ConfirmDialog } from "@/components/design-system/ConfirmDialog";

type DeleteUnreadableProps = {
  resumeId: string;
  jobTitle: string;
  companyName: string;
  date: string;
  /** Its interviews, which deleting it takes along: the confirmation names them. */
  interviews: number;
  /** The page heading's id: focus goes there once the row is gone. */
  returnFocusTo: string;
};

/**
 * Delete for a row whose stored analysis can't be read: its page redirects back here, so this is the only way to
 * remove it and its CV. Outcomes are toasts, as on the analysis page: the row (and this button) goes away on success.
 */
export function DeleteUnreadable({ resumeId, jobTitle, companyName, date, interviews, returnFocusTo }: DeleteUnreadableProps) {
  const { t } = useTranslation("analyses");
  const errorCopy = useErrorCopy();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const deleted = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const confirm = async () => {
    setPending(true);
    try {
      const result = await deleteOneAnalysisAction({ resumeId });
      if (result.ok) {
        deleted.current = true;
        toast.success(t("result.deletedOne", { jobTitle, companyName }));
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
        aria-label={t("row.deleteLabel", { jobTitle, companyName, date })}
        className={buttonClass({ variant: "ghost", size: "sm" })}
      >
        {t("row.delete")}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("confirm.oneTitle")}
        body={interviews > 0 ? t("confirm.oneBodyInterviews", { jobTitle, companyName, date, count: interviews }) : t("confirm.oneBody", { jobTitle, companyName, date })}
        confirmLabel={t("confirm.oneConfirm")}
        cancelLabel={t("confirm.keep")}
        pendingLabel={t("confirm.deleting")}
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
