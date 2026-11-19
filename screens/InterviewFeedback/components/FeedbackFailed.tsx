import type { InterviewStatus } from "@prisma/client";
import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/design-system/Button";
import ClientMessages from "@/components/i18n/ClientMessages";
import { getT } from "@/lib/i18n/server";
import { failureCopy } from "../utils/failureCopy";
import { FeedbackState } from "./FeedbackPage";
import RetryFeedbackButton from "./RetryFeedbackButton";
import { StatusLine } from "./StatusLine";

type FeedbackFailedProps = {
  interview: {
    id: string;
    role: string;
    status: InterviewStatus;
    failureReason: string | null;
    startCount: number;
  };
  date: string;
};

/** FAILED and EXPIRED, in plain words, with whatever is left to do. */
export default async function FeedbackFailed({ interview, date }: FeedbackFailedProps) {
  const t = await getT("feedback");
  const copy = failureCopy(interview.status, interview.failureReason);

  return (
    <FeedbackState
      role={interview.role}
      date={date}
      t={t}
      actions={
        copy.canRetryFeedback ? (
          <ClientMessages ns={["feedback"]}>
            <RetryFeedbackButton interviewId={interview.id} />
          </ClientMessages>
        ) : (
          <ButtonLink href="/resume/analyses">
            {t("actions.pickAnalysis")}
            <ArrowRight aria-hidden className="size-4" />
          </ButtonLink>
        )
      }
    >
      <StatusLine kind="stopped" title={t(`failure.${copy.kind}.title`)} body={t(`failure.${copy.kind}.body`)} />
    </FeedbackState>
  );
}
