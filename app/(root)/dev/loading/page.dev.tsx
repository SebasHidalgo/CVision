import { notFound } from "next/navigation";
import { devToolsAllowed } from "@/lib/devTools";
import InterviewLoading from "@/screens/Interview/InterviewLoading";
import InterviewFeedbackLoading from "@/screens/InterviewFeedback/InterviewFeedbackLoading";
import InterviewsLoading from "@/screens/Interviews/InterviewsLoading";
import ResumeAnalysesLoading from "@/screens/ResumeAnalyses/ResumeAnalysesLoading";
import ResumeAnalysisDetailLoading from "@/screens/ResumeAnalysisDetail/ResumeAnalysisDetailLoading";
import ResumeUploadLoading from "@/screens/ResumeUpload/ResumeUploadLoading";

// Dev only (404 without dev tools): each page's loading state, held still, so it can be looked at and measured.
const LOADING = {
  upload: () => <ResumeUploadLoading />,
  analyses: () => <ResumeAnalysesLoading />,
  analysis: () => <ResumeAnalysisDetailLoading />,
  interviews: () => <InterviewsLoading />,
  room: () => <InterviewLoading />,
  feedback: () => <InterviewFeedbackLoading />,
} as const;

const isLoadingPage = (page: string): page is keyof typeof LOADING => Object.keys(LOADING).includes(page);

export default async function LoadingPreviewPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (!devToolsAllowed()) notFound();
  const { page = "" } = await searchParams;
  const render = isLoadingPage(page) ? LOADING[page] : null;
  if (!render) notFound();
  return render();
}
