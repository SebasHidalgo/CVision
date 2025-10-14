import ResumesAnalysesContentPage from "@/components/resume/Resumes-Analyses-Content-Page";
import { fetchAllResumes } from "@/lib/database/resume";

export default async function AnalysesPage() {
  const resumesAnalysis = await fetchAllResumes();
  if(!resumesAnalysis) {
    return <div>No resumes found</div>;
  }
  return <ResumesAnalysesContentPage resumesAnalysis={resumesAnalysis} />;
}
