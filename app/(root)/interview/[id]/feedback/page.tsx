import { fetchFeedbackByInterviewId } from "@/lib/database/interview";
import { redirect } from "next/navigation";
import InterviewFeedbackContainer from "@/components/interview/InterviewFeedbackContainer";

type InterviewPageParams = Promise<{ id: string }>;

export default async function InterviewFeedbackPage({
  params,
}: {
  params: InterviewPageParams;
}) {
  const id = (await params).id;

  const feedback = await fetchFeedbackByInterviewId(id);
  if (!feedback) redirect("/interviews");

  return (
    <div className="container mx-auto px-4 py-12">
      <InterviewFeedbackContainer feedback={feedback} />
    </div>
  );
}
