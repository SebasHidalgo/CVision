"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { retryInterviewFeedbackAction } from "@/screens/InterviewFeedback/actions/retryInterviewFeedbackAction";

type RetryFeedbackButtonProps = {
  interviewId: string;
};

export default function RetryFeedbackButton({ interviewId }: RetryFeedbackButtonProps) {
  const router = useRouter();
  const { t } = useTranslation("feedback");
  const errorCopy = useErrorCopy();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      const result = await retryInterviewFeedbackAction({ interviewId });
      if (result.ok) {
        // Keep the spinner: the refresh swaps this screen for the report or
        // the pending state, which unmounts the button.
        router.refresh();
        return;
      }
      toast.error(errorCopy(result.code));
    } catch {
      toast.error(errorCopy("REQUEST_FAILED"));
    }
    setIsRetrying(false);
  };

  return (
    <Button onClick={handleRetry} disabled={isRetrying} className="h-11 gap-2 px-5">
      {isRetrying ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {t("retry.generating")}
        </>
      ) : (
        <>
          <RotateCcw className="size-4" />
          {t("retry.again")}
        </>
      )}
    </Button>
  );
}
