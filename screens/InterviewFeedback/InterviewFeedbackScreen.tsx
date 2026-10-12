import { redirect } from "next/navigation";
import { after } from "next/server";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import {
  fetchFeedbackByInterviewId,
  fetchInterviewById,
} from "@/lib/database/interview";
import { formatLongDate } from "@/lib/format";
import { interviewPhase } from "@/lib/interviewStatus";
import FeedbackFailed from "./components/FeedbackFailed";
import FeedbackPending from "./components/FeedbackPending";
import FeedbackReport from "./components/FeedbackReport";
import FeedbackUnavailable from "./components/FeedbackUnavailable";

type InterviewFeedbackScreenProps = {
  interviewId: string;
};

export default async function InterviewFeedbackScreen({
  interviewId,
}: InterviewFeedbackScreenProps) {
  // Already scoped to the owner: another user's interview comes back null.
  const interview = await fetchInterviewById(interviewId);
  if (!interview) redirect("/interviews");

  const phase = interviewPhase(interview.status);
  if (phase === "ready") redirect(`/interview/${interview.id}`);

  const date = formatLongDate(interview.createdAt);

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
    return <FeedbackPending role={interview.role} date={date} />;
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

  const feedback = await fetchFeedbackByInterviewId(interview.id);
  if (!feedback) return <FeedbackUnavailable role={interview.role} date={date} />;

  return <FeedbackReport feedback={feedback} date={date} />;
}
