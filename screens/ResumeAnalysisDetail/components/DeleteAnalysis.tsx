"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Eyebrow from "@/components/layout/Eyebrow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { deleteAnalysisAction } from "@/screens/ResumeAnalysisDetail/actions/deleteAnalysisAction";

type DeleteAnalysisProps = {
  resumeId: string;
  jobTitle: string;
  companyName: string;
};

/**
 * The one destructive control on the page, behind a dialog that says what
 * goes. On success the page is gone, so the spinner stays until the list
 * replaces it; a refusal (a rehearsal in progress) is a toast and the
 * dialog closes.
 */
export default function DeleteAnalysis({ resumeId, jobTitle, companyName }: DeleteAnalysisProps) {
  const router = useRouter();
  const { t } = useTranslation("analysis");
  const errorCopy = useErrorCopy();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const confirm = async (event: React.MouseEvent) => {
    // The action closes the dialog by default; keep it open while deleting.
    event.preventDefault();
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
    <section aria-labelledby="delete-analysis-title" className="mt-16 border-t border-line pt-10 lg:mt-20">
      <Eyebrow tick>{t("delete.eyebrow")}</Eyebrow>
      <div className="mt-5 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-xl">
          <h2 id="delete-analysis-title" className="text-lg font-medium text-ink">
            {t("delete.title")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{t("delete.body")}</p>
        </div>

        <AlertDialog open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="h-11 gap-2 px-5 text-signal hover:text-signal">
              <Trash2 className="size-4" />
              {t("delete.trigger")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-line-strong bg-paper">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-ink">{t("delete.dialogTitle")}</AlertDialogTitle>
              <AlertDialogDescription className="text-ink-2">
                {t("delete.dialogBody", { jobTitle, companyName })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t("delete.keep")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirm}
                disabled={deleting}
                className="bg-signal text-paper hover:bg-signal/90"
              >
                {deleting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("delete.deleting")}
                  </>
                ) : (
                  t("delete.confirm")
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}
