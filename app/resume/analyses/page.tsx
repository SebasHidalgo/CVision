import ResumesAnalysesContentPage from "@/components/resume/Resumes-Analyses-Content-Page";
import { fetchAllResumesByUser } from "@/lib/database/resume";
import { auth } from "@clerk/nextjs/server";

export default async function AnalysesPage() {
  const { userId } = await auth();

  const resumesAnalysis = await fetchAllResumesByUser(userId!);
  if (!resumesAnalysis) {
    return <div>No resumes found</div>;
  }
  return <ResumesAnalysesContentPage resumesAnalysis={resumesAnalysis} />;
}
