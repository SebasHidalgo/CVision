import ResumeAnalysisContent from "@/components/resume/analysis/ResumeAnalysis";
import { fetchResumeById } from "@/lib/database/resume";
import { redirect } from "next/navigation";
import React from "react";

type SingleProductPageParams = Promise<{ id: string }>;

export default async function ResumeAnalysisPage({
  params,
}: {
  params: SingleProductPageParams;
}) {
  const id = (await params).id;
  const resumeAnalysis = await fetchResumeById(id);

  if (!resumeAnalysis) redirect("/");

  return <ResumeAnalysisContent resumeAnalysis={resumeAnalysis} />;
}
