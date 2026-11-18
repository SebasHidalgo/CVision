"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { buttonClass } from "@/components/design-system/Button";
import { ConfirmDialog } from "@/components/design-system/ConfirmDialog";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { deleteAnalysisAction } from "@/screens/ResumeAnalysisDetail/actions/deleteAnalysisAction";

type DeleteAnalysisProps = {
  resumeId: string;
  jobTitle: string;
  companyName: string;
};

/**
 * The one destructive control on the page, behind a dialog that says what
 * goes. On success the page is gone, so the pending label stays until the
 * list replaces it; a refusal (a rehearsal in progress) is a toast and the
 * dialog closes.
 */
export default function DeleteAnalysis({ resumeId, jobTitle, companyName }: DeleteAnalysisProps) {
  const router = useRouter();
  const { t } = useTranslation("analysis");
  const errorCopy = useErrorCopy();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const confirm = async () => {
    setDeleting(true);
    try {
      const result = await deleteAnalysisAction({ resumeId });
      if (result.ok) {
        router.push("/resume/analyses");
        return;
      }
      toast.error(errorCopy(result.code));
    } catch {
      toast.error(errorCopy("REQUEST_FAILED"));
    }
    setDeleting(false);
    setOpen(false);
  };

  return (
    <section aria-labelledby="delete-analysis-title" className="mt-20 border-t border-ed-line pt-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-[60ch]">
          <h2 id="delete-analysis-title" className="text-ed-h3 font-semibold text-ed-ink">
            {t("delete.title")}
          </h2>
          <p className="mt-2 text-ed-body text-ed-ink-2">{t("delete.body")}</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className={buttonClass({ variant: "ghost", className: "self-start md:self-auto" })}>
          <Trash2 aria-hidden className="size-4 flex-none" />
          {t("delete.trigger")}
        </button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={t("delete.dialogTitle")}
          body={t("delete.dialogBody", { jobTitle, companyName })}
          confirmLabel={t("delete.confirm")}
          cancelLabel={t("delete.keep")}
          pendingLabel={t("delete.deleting")}
          pending={deleting}
          onConfirm={confirm}
        />
      </div>
    </section>
  );
}
