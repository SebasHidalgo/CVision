import ResumeAnalysisDetailScreen from "@/screens/ResumeAnalysisDetail/ResumeAnalysisDetailScreen";

// Bounds createInterviewAction (two database round trips, no model call) and
// translateAnalysisAction (one translation call, 25 s timeout). A literal, as Next requires.
export const maxDuration = 30;

type ResumeAnalysisPageParams = Promise<{ id: string }>;
type ResumeAnalysisPageSearch = Promise<{ original?: string | string[] }>;

export default async function ResumeAnalysisPage({
  params,
  searchParams,
}: {
  params: ResumeAnalysisPageParams;
  searchParams: ResumeAnalysisPageSearch;
}) {
  const [{ id }, { original }] = await Promise.all([params, searchParams]);

  return <ResumeAnalysisDetailScreen resumeAnalysisId={id} original={original === "1"} />;
}
