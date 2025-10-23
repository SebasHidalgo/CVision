import InterviewAgent from "@/components/interview/InterviewAgent";
import { fetchInterviewById } from "@/lib/database/interview";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

type InterviewPageParams = Promise<{ id: string }>;

export default async function InterviewPage({
  params,
}: {
  params: InterviewPageParams;
}) {
  const id = (await params).id;
  
  const interview = await fetchInterviewById(id);
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
