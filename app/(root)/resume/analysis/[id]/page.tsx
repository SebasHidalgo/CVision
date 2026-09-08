import ResumeAnalysisDetailScreen from "@/screens/ResumeAnalysisDetail/ResumeAnalysisDetailScreen";

type ResumeAnalysisPageParams = Promise<{ id: string }>;

export default async function ResumeAnalysisPage({
  params,
}: {
  params: ResumeAnalysisPageParams;
}) {
  const { id } = await params;

  return <ResumeAnalysisDetailScreen resumeAnalysisId={id} />;
}
