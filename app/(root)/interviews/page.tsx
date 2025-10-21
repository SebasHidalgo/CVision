import InterviewsContainer from "@/components/interview/InterviewsContainer";
import { fetchAllInterviewsByUser } from "@/lib/database/interview";
import { auth } from "@clerk/nextjs/server";

export default async function InterviewsPage() {
  const { userId } = await auth();
  const interviews = await fetchAllInterviewsByUser(userId!);

  if (!interviews) {
    return <div>No interviews found</div>;
  }

  return <InterviewsContainer interviews={interviews} />;
}
