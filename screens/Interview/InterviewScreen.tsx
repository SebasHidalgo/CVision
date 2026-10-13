import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { fetchInterviewById } from "@/lib/database/interview";
import {
  MAX_INTERVIEW_DURATION_SECONDS,
  MAX_INTERVIEW_STARTS,
} from "@/lib/elevenlabs/agentConfig";
import { interviewPhase } from "@/lib/interviewStatus";
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

  return (
    <InterviewRoomLoader
      interviewId={interview.id}
      role={interview.role}
      company={interview.resumeAnalysis.companyName}
      candidateName={user.firstName ?? user.fullName}
      analysisId={interview.resumeAnalysisId}
      startCount={interview.startCount}
      maxStarts={MAX_INTERVIEW_STARTS}
      maxDurationSeconds={MAX_INTERVIEW_DURATION_SECONDS}
    />
  );
}
