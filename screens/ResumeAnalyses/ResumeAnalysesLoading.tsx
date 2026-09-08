import PageIntro from "@/components/layout/PageIntro";
import { AnalysesListSkeleton } from "./components/AnalysesSkeleton";

export default function ResumeAnalysesLoading() {
  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro eyebrow="Your analyses" title="Every CV you have measured." />
      <AnalysesListSkeleton />
    </div>
  );
}
