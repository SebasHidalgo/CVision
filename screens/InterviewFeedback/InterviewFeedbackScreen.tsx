import { redirect } from "next/navigation";
import { after } from "next/server";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import {
  fetchFeedbackByInterviewId,
  fetchInterviewById,
  fetchInterviewTranscript,
} from "@/lib/database/interview";
import { MAX_INTERVIEW_STARTS } from "@/lib/elevenlabs/agentConfig";
import { NO_CANDIDATE_TURNS } from "@/lib/elevenlabs/postCall";
import { formatLongDate } from "@/lib/format";
import { interviewPhase } from "@/lib/interviewStatus";
import FeedbackFailed from "./components/FeedbackFailed";
import FeedbackPending from "./components/FeedbackPending";
import FeedbackReport from "./components/FeedbackReport";
import FeedbackUnavailable from "./components/FeedbackUnavailable";
import NothingHeard from "./components/NothingHeard";

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
  const interview = await fetchInterviewById(interviewId);
  if (!interview) redirect("/interviews");

  const phase = interviewPhase(interview.status);
  const date = formatLongDate(interview.createdAt);

  if (phase === "ready") {
    if (!justEnded) redirect(`/interview/${interview.id}`);

    // The webhook came back with no candidate turns: the interview is still
    // theirs to start, and the room is where that happens.
    if (interview.failureReason === NO_CANDIDATE_TURNS) {
      return (
        <NothingHeard
          interview={{ id: interview.id, role: interview.role }}
          attemptsLeft={Math.max(0, MAX_INTERVIEW_STARTS - interview.startCount)}
          date={date}
        />
      );
    }
    return <FeedbackPending role={interview.role} date={date} waitingFor="transcript" />;
  }

  if (phase === "pending") {
    // The lazy path. The webhook's after() normally gets here first; when it
    // did not (a lost callback, a dead worker), this page is the retry. The
    // generator claims the row conditionally, so a page load racing the
    // webhook produces one model call, and the page polls until it lands.
    after(async () => {
      try {
        const outcome = await generateInterviewFeedback(interview.id);
        console.info(`[CVision][feedback] page trigger interview=${interview.id}: ${outcome.kind}`);
      } catch (error) {
        console.error(`[CVision][feedback] page trigger interview=${interview.id} threw:`, error);
      }
    });
    return <FeedbackPending role={interview.role} date={date} waitingFor="scoring" />;
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
