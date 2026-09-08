import { redirect } from "next/navigation";
import { fetchFeedbackByInterviewId } from "@/lib/database/interview";
import { formatLongDate } from "@/lib/format";
import FeedbackReport from "./components/FeedbackReport";

type InterviewFeedbackScreenProps = {
  interviewId: string;
};

export default async function InterviewFeedbackScreen({
  interviewId,
}: InterviewFeedbackScreenProps) {
  const feedback = await fetchFeedbackByInterviewId(interviewId);
  if (!feedback) redirect("/interviews");

  return (
    <FeedbackReport feedback={feedback} date={formatLongDate(feedback.createdAt)} />
  );
}
