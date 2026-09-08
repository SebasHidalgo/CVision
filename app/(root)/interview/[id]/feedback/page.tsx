import InterviewFeedbackScreen from "@/screens/InterviewFeedback/InterviewFeedbackScreen";

type InterviewFeedbackPageParams = Promise<{ id: string }>;

export default async function InterviewFeedbackPage({
  params,
}: {
  params: InterviewFeedbackPageParams;
}) {
  const { id } = await params;

  return <InterviewFeedbackScreen interviewId={id} />;
}
