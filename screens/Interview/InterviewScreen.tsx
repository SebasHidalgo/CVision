import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { fetchInterviewById } from "@/lib/database/interview";
import { interviewPhase } from "@/lib/interviewStatus";
import InterviewAgent from "./components/InterviewAgent";

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
  if (!interview.resumeAnalysis) redirect("/interviews");

  const user = await getAuthUser();

  return (
    <InterviewAgent
      interviewId={interview.id}
      role={interview.role}
      jobDescription={interview.resumeAnalysis.jobDescription}
      userName={user.firstName ?? "there"}
      userProfilePic={user.imageUrl}
    />
  );
}
