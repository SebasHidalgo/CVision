import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { fetchInterviewById } from "@/lib/database/interview";
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

  // Without a linked analysis there is no job context for the interviewer.
  if (!interview.resumeAnalysis) redirect("/interviews");

  const user = await currentUser();
  if (!user) redirect("/");

  return (
    <InterviewAgent
      interviewId={interview.id}
      jobDescription={interview.resumeAnalysis.jobDescription}
      userName={user.firstName ?? "there"}
      userProfilePic={user.imageUrl}
    />
  );
}
