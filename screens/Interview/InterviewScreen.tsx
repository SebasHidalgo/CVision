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
  const interview = await fetchInterviewById(interviewId);
  if (!interview) redirect("/");

  const user = await currentUser();

  return (
    <InterviewAgent
      interviewId={interview.id}
      jobDescription={interview.resumeAnalysis!.jobDescription}
      userName={user!.firstName!}
      userId={user!.id}
      userProfilePic={user!.imageUrl}
    />
  );
}
