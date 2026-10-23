import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { fetchInterviewById } from "@/lib/database/interview";
import { currentInterviewEntitlement } from "@/lib/database/usage";
import { MAX_INTERVIEW_STARTS } from "@/lib/elevenlabs/agentConfig";
import { sourceOfPaidBy } from "@/lib/interviewEntitlement";
import { interviewPhase } from "@/lib/interviewStatus";
import { INTERVIEW_TIERS } from "@/lib/plans";
import InterviewRoomLoader from "./components/InterviewRoomLoader";

type InterviewScreenProps = {
  interviewId: string;
};

export default async function InterviewScreen({
  interviewId,
}: InterviewScreenProps) {
  // Already scoped to the owner: another user's interview comes back null.
  const interview = await fetchInterviewById(interviewId);
  if (!interview) redirect("/interviews");

  // Only an interview with nothing scoreable yet opens the room. Everything
  // else (pending, done, failed, expired) is the feedback page's to explain.
  if (interviewPhase(interview.status) !== "ready") {
    redirect(`/interview/${interview.id}/feedback`);
  }

  // Without a linked analysis there is no job context for the interviewer.
  if (!interview.resumeAnalysis || !interview.resumeAnalysisId) redirect("/interviews");

  const user = await getAuthUser();

  // Before the first token, what the next start would get is decided by
  // the one entitlement function the session endpoint will run too, so
  // the length the room shows is the length the call will have. After it,
  // the interview's own tier and source are the truth (a reconnect keeps
  // them).
  const paid = interview.tier && interview.usageEventId ? { tier: interview.tier, source: sourceOfPaidBy(interview.paidBy) } : null;
  const entitlement = paid ? null : await currentInterviewEntitlement();
  const maxDurationSeconds = paid ? INTERVIEW_TIERS[paid.tier].seconds : (entitlement?.maxDurationSeconds ?? 0);
  const source = paid ? paid.source : (entitlement?.source ?? "none");

  return (
    <InterviewRoomLoader
      interviewId={interview.id}
      role={interview.role}
      company={interview.resumeAnalysis.companyName}
      candidateName={user.firstName ?? user.fullName}
      analysisId={interview.resumeAnalysisId}
      attemptNumber={interview.attemptNumber}
      startCount={interview.startCount}
      maxStarts={MAX_INTERVIEW_STARTS}
      maxDurationSeconds={maxDurationSeconds}
      source={source}
    />
  );
}
