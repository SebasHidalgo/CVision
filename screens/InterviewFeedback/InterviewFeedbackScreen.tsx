import { redirect } from "next/navigation";
import { after } from "next/server";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import {
  fetchFeedbackByInterviewId,
  fetchInterviewById,
  fetchInterviewTranscript,
} from "@/lib/database/interview";
import { MAX_INTERVIEW_DURATION_SECONDS, MAX_INTERVIEW_STARTS } from "@/lib/elevenlabs/agentConfig";
import { isStranded } from "@/lib/elevenlabs/postCall";
import { reconcileChangedRow, reconcileStrandedInterview } from "@/lib/elevenlabs/reconcile";
import { formatLongDate } from "@/lib/format";
import AttemptNotScored from "./components/AttemptNotScored";
import FeedbackFailed from "./components/FeedbackFailed";
import FeedbackPending from "./components/FeedbackPending";
import FeedbackReport from "./components/FeedbackReport";
import FeedbackUnavailable from "./components/FeedbackUnavailable";
import InterviewMayBeLive from "./components/InterviewMayBeLive";
import { decideFeedbackView } from "./utils/feedbackView";

type InterviewFeedbackScreenProps = {
  interviewId: string;
  /**
   * The room sends the candidate here the moment the call ends, before the
   * platform has delivered the transcript. With this set, a still-startable
   * interview is shown as "saving" and polled instead of bounced to the room.
   */
  justEnded: boolean;
};

export default async function InterviewFeedbackScreen({
  interviewId,
  justEnded,
}: InterviewFeedbackScreenProps) {
  // Already scoped to the owner: another user's interview comes back null.
  const found = await fetchInterviewById(interviewId);
  if (!found) redirect("/interviews");

  const now = new Date();
  const candidateOf = (row: typeof found) => ({
    status: row.status,
    conversationId: row.conversationId,
    hasTranscript: row.transcriptSource !== null,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  });

  // The webhook never came and the call must be over: fetch the transcript
  // from the platform through the same path the webhook uses. The poll does
  // this too; here it covers a page opened long after the call.
  let interview = found;
  if (isStranded(candidateOf(interview), now, MAX_INTERVIEW_DURATION_SECONDS)) {
    try {
      const outcome = await reconcileStrandedInterview(interview.id, now);
      if (reconcileChangedRow(outcome)) {
        interview = (await fetchInterviewById(interview.id)) ?? interview;
      }
    } catch (error) {
      console.error(`[CVision][feedback] reconcile interview=${interview.id} failed:`, error);
    }
  }

  const view = decideFeedbackView(
    { ...candidateOf(interview), failureReason: interview.failureReason, justEnded },
    now,
    MAX_INTERVIEW_DURATION_SECONDS,
  );
  if (view.kind === "room") redirect(`/interview/${interview.id}`);

  const date = formatLongDate(interview.createdAt);
  const seen = {
    status: interview.status,
    hasFeedback: false,
    failureReason: interview.failureReason,
  };

  switch (view.kind) {
    case "live-notice":
      return <InterviewMayBeLive interview={{ id: interview.id, role: interview.role }} date={date} />;
    case "not-scored":
      return (
        <AttemptNotScored
          interview={{ id: interview.id, role: interview.role }}
          reason={view.reason}
          startsLeft={Math.max(0, MAX_INTERVIEW_STARTS - interview.startCount)}
          date={date}
        />
      );
    case "pending-transcript":
      return (
        <FeedbackPending
          interviewId={interview.id}
          analysisId={interview.resumeAnalysisId}
          role={interview.role}
          date={date}
          waitingFor="transcript"
          seen={seen}
        />
      );
    case "pending-scoring": {
      // The lazy path, once per render. The webhook's after() normally gets
      // here first; when it did not (a lost callback, a dead worker), this is
      // the retry. The generator claims the row conditionally, so a render
      // racing the webhook produces one model call; the poller re-renders
      // this page only when the status changes, not on every poll.
      const id = interview.id;
      after(async () => {
        try {
          const outcome = await generateInterviewFeedback(id);
          console.info(`[CVision][feedback] page trigger interview=${id}: ${outcome.kind}`);
        } catch (error) {
          console.error(`[CVision][feedback] page trigger interview=${id} threw:`, error);
        }
      });
      return (
        <FeedbackPending
          interviewId={interview.id}
          analysisId={interview.resumeAnalysisId}
          role={interview.role}
          date={date}
          waitingFor="scoring"
          seen={seen}
        />
      );
    }
    case "failed":
      return (
        <FeedbackFailed
          interview={{
            id: interview.id,
            role: interview.role,
            status: interview.status,
            failureReason: interview.failureReason,
            startCount: interview.startCount,
          }}
          date={date}
        />
      );
    case "report": {
      const [feedback, transcript] = await Promise.all([
        fetchFeedbackByInterviewId(interview.id),
        fetchInterviewTranscript(interview.id),
      ]);
      if (!feedback) return <FeedbackUnavailable role={interview.role} date={date} />;
      return <FeedbackReport feedback={feedback} transcript={transcript} date={date} />;
    }
  }
}
