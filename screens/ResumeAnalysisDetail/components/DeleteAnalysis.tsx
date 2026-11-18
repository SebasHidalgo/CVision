"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { buttonClass } from "@/components/design-system/Button";
import { fontText } from "@/components/design-system/fonts";
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
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { cn } from "@/lib/utils";
import { deleteAnalysisAction } from "@/screens/ResumeAnalysisDetail/actions/deleteAnalysisAction";

type DeleteAnalysisProps = {
  resumeId: string;
  jobTitle: string;
  companyName: string;
};

// The dialog renders in a portal, outside the page root: it brings its own face, colours and focus ring, and its
// buttons override the shadcn button classes they are built on (the wrapper merges ours last).
const FOCUS = "focus-visible:border-ed-ink focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-solid focus-visible:outline-ed-ink";
const DIALOG = cn(
  fontText.variable,
  "font-ed-text gap-5 rounded-ed-surface border-ed-line-2 bg-ed-panel p-6 text-ed-ink shadow-ed-surface sm:max-w-[30rem]",
);
const pill = (variant: "solid" | "ghost") =>
  cn(
    buttonClass({ variant, size: "sm" }),
    "h-auto shadow-none has-[>svg]:px-4 disabled:opacity-70",
    variant === "solid" ? "hover:bg-ed-ink" : "hover:bg-transparent hover:text-ed-ink",
    FOCUS,
  );

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
    <section aria-labelledby="delete-analysis-title" className="mt-20 border-t border-ed-line pt-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-[60ch]">
          <h2 id="delete-analysis-title" className="text-ed-h3 font-semibold text-ed-ink">
            {t("delete.title")}
          </h2>
          <p className="mt-2 text-ed-body text-ed-ink-2">{t("delete.body")}</p>
        </div>

        <AlertDialog open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
          <AlertDialogTrigger asChild>
            <button type="button" className={buttonClass({ variant: "ghost", className: "self-start md:self-auto" })}>
              <Trash2 aria-hidden className="size-4 flex-none" />
              {t("delete.trigger")}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className={DIALOG}>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-ed-h3 font-semibold text-ed-ink">{t("delete.dialogTitle")}</AlertDialogTitle>
              <AlertDialogDescription className="text-ed-body text-ed-ink-2">
                {t("delete.dialogBody", { jobTitle, companyName })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-3">
              <AlertDialogCancel disabled={deleting} className={pill("ghost")}>
                {t("delete.keep")}
              </AlertDialogCancel>
              <AlertDialogAction onClick={confirm} disabled={deleting} className={pill("solid")}>
                {deleting ? (
                  <>
                    <Loader2 aria-hidden className="size-4 animate-spin" />
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
