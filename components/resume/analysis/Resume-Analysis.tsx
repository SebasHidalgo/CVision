import { ResumeAnalysis } from "@/types/resume";
import React from "react";
import PdfPreview from "./Pdf-Viewer";
import ResumeFeedback from "./Resume-Feedback";

type ResumeAnalysisProps = {
  resumeAnalysis: ResumeAnalysis;
};

export default function ResumeAnalysisContent({
  resumeAnalysis,
}: ResumeAnalysisProps) {
  return (
    <div className="relative overflow-hidden bg-background min-h-screen">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/20 via-background to-background pointer-events-none" />
      <div className="container mx-auto px-4 py-8 relative z-10">
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <ResumeFeedback feedback={resumeAnalysis.feedback} />
          <PdfPreview resumeUrl={resumeAnalysis.resumeUrl} />
        </div>
      </div>
    </div>
  );
}
