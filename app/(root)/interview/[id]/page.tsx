import InterviewScreen from "@/screens/Interview/InterviewScreen";

// One database read and a Clerk profile read: the voice session itself is
// issued by /api/interview/[id]/session, which carries its own budget.
export const maxDuration = 30;

type InterviewPageParams = Promise<{ id: string }>;

export default async function InterviewPage({
  params,
}: {
  params: InterviewPageParams;
}) {
  const { id } = await params;

  return <InterviewScreen interviewId={id} />;
}
