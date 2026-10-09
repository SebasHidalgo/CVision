import InterviewScreen from "@/screens/Interview/InterviewScreen";

// Bounds submitInterviewFeedbackAction: a database read, the 45 s AI timeout
// and the feedback write. A literal, as Next requires.
export const maxDuration = 60;

type InterviewPageParams = Promise<{ id: string }>;

export default async function InterviewPage({
  params,
}: {
  params: InterviewPageParams;
}) {
  const { id } = await params;

  return <InterviewScreen interviewId={id} />;
}
