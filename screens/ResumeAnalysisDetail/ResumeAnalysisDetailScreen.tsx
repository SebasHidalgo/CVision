import { redirect } from "next/navigation";
import { fetchResumeById } from "@/lib/database/resume";
import PdfPreview from "./components/PdfViewer";
import ResumeFeedback from "./components/ResumeFeedback";

type ResumeAnalysisDetailScreenProps = {
  resumeAnalysisId: string;
};

export default async function ResumeAnalysisDetailScreen({
  resumeAnalysisId,
}: ResumeAnalysisDetailScreenProps) {
  const resumeAnalysis = await fetchResumeById(resumeAnalysisId);
  if (!resumeAnalysis) redirect("/");

  return (
    <div className="relative overflow-hidden bg-background min-h-screen">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/20 via-background to-background pointer-events-none" />
      <div className="container mx-auto px-4 py-12 relative z-10">
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <ResumeFeedback
            feedback={resumeAnalysis.feedback}
            interviewDetails={{
              jobRole: resumeAnalysis.jobTitle,
              jobDescription: resumeAnalysis.jobDescription,
              resumeId: resumeAnalysis.id,
            }}
          />
          <PdfPreview resumeUrl={resumeAnalysis.resumeUrl} />
        </div>
      </div>
    </div>
  );
}
