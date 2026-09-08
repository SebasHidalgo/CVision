import { redirect } from "next/navigation";
import { fetchFeedbackByInterviewId } from "@/lib/database/interview";
import InterviewFeedbackContainer from "./components/InterviewFeedbackContainer";

type InterviewFeedbackScreenProps = {
  interviewId: string;
};

export default async function InterviewFeedbackScreen({
  interviewId,
}: InterviewFeedbackScreenProps) {
  const feedback = await fetchFeedbackByInterviewId(interviewId);
  if (!feedback) redirect("/interviews");

  return (
    <div className="container mx-auto px-4 py-12">
      <InterviewFeedbackContainer feedback={feedback} />
    </div>
  );
}
