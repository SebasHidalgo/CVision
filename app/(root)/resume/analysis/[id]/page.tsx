import ResumeAnalysisDetailScreen from "@/screens/ResumeAnalysisDetail/ResumeAnalysisDetailScreen";

// Bounds createInterviewAction: two database round trips around the 10 s
// techstack timeout. A literal, as Next requires.
export const maxDuration = 30;

type ResumeAnalysisPageParams = Promise<{ id: string }>;

export default async function ResumeAnalysisPage({
  params,
}: {
  params: ResumeAnalysisPageParams;
}) {
  const { id } = await params;

  return <ResumeAnalysisDetailScreen resumeAnalysisId={id} />;
}
