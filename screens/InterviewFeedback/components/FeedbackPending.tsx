import ClientMessages from "@/components/i18n/ClientMessages";
import { getT } from "@/lib/i18n/server";
import type { InterviewStatusSnapshot } from "@/lib/schemas/interviewSessionSchema";
import { FeedbackState } from "./FeedbackPage";
import StatusPoller from "./StatusPoller";
import { StatusLine } from "./StatusLine";

type FeedbackPendingProps = {
  interviewId: string;
  /** The analysis the attempts are listed under; null when it was deleted. */
  analysisId: string | null;
  role: string;
  date: string;
  /**
   * "transcript": the call just ended and the platform has not delivered the
   * transcript yet. "scoring": the transcript is stored and being read.
   */
  waitingFor: "transcript" | "scoring";
  /** What this render is based on; the poller re-renders when it changes. */
  seen: Pick<InterviewStatusSnapshot, "status" | "hasFeedback" | "failureReason">;
};

/** Shown while the interview is being saved or scored; polls until it is, or until the ceiling. */
export default async function FeedbackPending({ interviewId, analysisId, role, date, waitingFor, seen }: FeedbackPendingProps) {
  const t = await getT("feedback");

  return (
    <FeedbackState role={role} date={date} t={t} status>
      {/* The poller's stalled notice is client copy. */}
      <ClientMessages ns={["feedback"]}>
        <StatusPoller interviewId={interviewId} seen={seen} attemptsHref={analysisId ? `/resume/analysis/${analysisId}` : "/interviews"}>
          <StatusLine
            kind="working"
            title={waitingFor === "transcript" ? t("pending.saving") : t("pending.preparing")}
            body={waitingFor === "transcript" ? t("pending.transcriptBody") : t("pending.scoringBody")}
          />
          <p className="mt-6 max-w-[60ch] text-ed-body text-ed-ink-2">{t("pending.leave")}</p>
        </StatusPoller>
      </ClientMessages>
    </FeedbackState>
  );
}
