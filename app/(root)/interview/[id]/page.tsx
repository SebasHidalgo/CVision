import InterviewScreen from "@/screens/Interview/InterviewScreen";

type InterviewPageParams = Promise<{ id: string }>;

export default async function InterviewPage({
  params,
}: {
  params: InterviewPageParams;
}) {
  const { id } = await params;

  return <InterviewScreen interviewId={id} />;
}
