import { NextRequest, NextResponse } from "next/server";
import { analyzeResume } from "@/lib/database/resume";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const companyName = formData.get("companyName") as string;
  const jobTitle = formData.get("jobTitle") as string;
  const jobDescription = formData.get("jobDescription") as string;
  const resumeFile = formData.get("resume") as File;

  const resumeId = await analyzeResume({
    companyName,
    jobTitle,
    jobDescription,
    resume: resumeFile,
  });

  return NextResponse.json(resumeId);
}
