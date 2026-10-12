import InterviewFeedbackScreen from "@/screens/InterviewFeedback/InterviewFeedbackScreen";

// Bounds the lazy feedback generation this page can start (after() while
// pending, or inline from the retry action): a 45 s model call plus writes.
// A literal, as Next requires.
export const maxDuration = 60;

type InterviewFeedbackPageParams = Promise<{ id: string }>;

export default async function InterviewFeedbackPage({
  params,
}: {
  params: InterviewFeedbackPageParams;
}) {
  const { id } = await params;

  return <InterviewFeedbackScreen interviewId={id} />;
}
