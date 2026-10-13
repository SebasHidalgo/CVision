import { redirect } from "next/navigation";
import { after } from "next/server";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import {
  fetchFeedbackByInterviewId,
  fetchInterviewById,
  fetchInterviewTranscript,
} from "@/lib/database/interview";
import { MAX_INTERVIEW_DURATION_SECONDS, MAX_INTERVIEW_STARTS } from "@/lib/elevenlabs/agentConfig";
import { isStranded, NO_CANDIDATE_TURNS, SESSION_LOST } from "@/lib/elevenlabs/postCall";
import { reconcileStrandedInterview } from "@/lib/elevenlabs/reconcile";
import { formatLongDate } from "@/lib/format";
import { interviewPhase } from "@/lib/interviewStatus";
import AttemptNotScored from "./components/AttemptNotScored";
import FeedbackFailed from "./components/FeedbackFailed";
import FeedbackPending from "./components/FeedbackPending";
import FeedbackReport from "./components/FeedbackReport";
import FeedbackUnavailable from "./components/FeedbackUnavailable";

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
  let interview = await fetchInterviewById(interviewId);
  if (!interview) redirect("/interviews");

  // The webhook never came and the call must be over: fetch the transcript
  // from the platform through the same path the webhook uses. The poll does
  // this too; here it covers a page opened long after the call.
  const strandedCandidate = {
    status: interview.status,
    conversationId: interview.conversationId,
    hasTranscript: interview.transcriptSource !== null,
    startedAt: interview.startedAt,
  };
  if (isStranded(strandedCandidate, new Date(), MAX_INTERVIEW_DURATION_SECONDS)) {
    try {
      const outcome = await reconcileStrandedInterview(interview.id);
      if (outcome.kind === "stored" || outcome.kind === "lost") {
        interview = (await fetchInterviewById(interview.id)) ?? interview;
      }
    } catch (error) {
      console.error(`[CVision][feedback] reconcile interview=${interview.id} failed:`, error);
    }
  }

  const phase = interviewPhase(interview.status);
  const date = formatLongDate(interview.createdAt);
  const seen = {
    status: interview.status,
    hasFeedback: false,
    failureReason: interview.failureReason,
  };

  if (phase === "ready") {
    if (!justEnded) redirect(`/interview/${interview.id}`);

    // The latest attempt produced nothing: the interview is still theirs to
    // start, and the room is where that happens.
    if (interview.failureReason === NO_CANDIDATE_TURNS || interview.failureReason === SESSION_LOST) {
      return (
        <AttemptNotScored
          interview={{ id: interview.id, role: interview.role }}
          reason={interview.failureReason === SESSION_LOST ? "lost" : "silent"}
          attemptsLeft={Math.max(0, MAX_INTERVIEW_STARTS - interview.startCount)}
          date={date}
        />
      );
    }
    return (
      <FeedbackPending
        interviewId={interview.id}
        role={interview.role}
        date={date}
        waitingFor="transcript"
        seen={seen}
      />
    );
  }

  if (phase === "pending") {
    // The lazy path, once per render. The webhook's after() normally gets
    // here first; when it did not (a lost callback, a dead worker), this is
    // the retry. The generator claims the row conditionally, so a render
    // racing the webhook produces one model call; the poller re-renders
    // this page only when the status changes, not on every poll.
    after(async () => {
      try {
        const outcome = await generateInterviewFeedback(interview.id);
        console.info(`[CVision][feedback] page trigger interview=${interview.id}: ${outcome.kind}`);
      } catch (error) {
        console.error(`[CVision][feedback] page trigger interview=${interview.id} threw:`, error);
      }
    });
    return (
      <FeedbackPending
        interviewId={interview.id}
        role={interview.role}
        date={date}
        waitingFor="scoring"
        seen={seen}
      />
    );
  }

  if (phase === "failed" || phase === "expired") {
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
  }

  const [feedback, transcript] = await Promise.all([
    fetchFeedbackByInterviewId(interview.id),
    fetchInterviewTranscript(interview.id),
  ]);
  if (!feedback) return <FeedbackUnavailable role={interview.role} date={date} />;

  return <FeedbackReport feedback={feedback} transcript={transcript} date={date} />;
}
