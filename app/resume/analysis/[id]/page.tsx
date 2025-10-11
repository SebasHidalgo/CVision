import ResumeAnalysisContent from "@/components/resume/Resume-Analysis";
import { fetchResumeById } from "@/lib/database/resume";
import React from "react";

type SingleProductPageParams = Promise<{ id: string }>;

export default async function ResumeAnalysisPage({
  params,
}: {
  params: SingleProductPageParams;
}) {
  const id = (await params).id;
  const resumeAnalysis = await fetchResumeById(id);

  if (!resumeAnalysis) {
    return <div>Resume analysis not found.</div>;
  }

  console.log(resumeAnalysis);

  return <ResumeAnalysisContent resumeAnalysis={resumeAnalysis} />;
}
