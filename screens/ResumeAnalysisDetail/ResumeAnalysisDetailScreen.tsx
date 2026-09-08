import { redirect } from "next/navigation";
import { fetchResumeById } from "@/lib/database/resume";
import { formatLongDate } from "@/lib/format";
import AnalysisHeader from "./components/AnalysisHeader";
import DimensionNav from "./components/DimensionNav";
import DimensionSections from "./components/DimensionSections";
import InterviewCta from "./components/InterviewCta";
import PriorityFixes from "./components/PriorityFixes";
import { DIMENSIONS, dimensionScores } from "./utils/dimensions";

type ResumeAnalysisDetailScreenProps = {
  resumeAnalysisId: string;
};

export default async function ResumeAnalysisDetailScreen({
  resumeAnalysisId,
}: ResumeAnalysisDetailScreenProps) {
  // Already scoped to the owner: another user's analysis comes back null.
  const analysis = await fetchResumeById(resumeAnalysisId);
  if (!analysis) redirect("/resume/analyses");

  // Stored feedback no longer matches the schema, so there is nothing to render.
  const { feedback } = analysis;
  if (!feedback) redirect("/resume/analyses");

  const scores = dimensionScores(feedback);
  const navItems = DIMENSIONS.map((dimension) => ({
    ...dimension,
    score: scores[dimension.id],
  }));

  return (
    <article className="wrap py-10 lg:py-14">
      <AnalysisHeader
        companyName={analysis.companyName}
        jobTitle={analysis.jobTitle}
        date={formatLongDate(analysis.createdAt)}
        score={feedback.overall.globalScore}
        summary={feedback.overall.summaryText}
        resumeUrl={analysis.resumeUrl}
        resumeId={analysis.id}
        interview={analysis.interview}
      />

      <PriorityFixes fixes={feedback.overall.prioritizedFixes} />

      {/* min-w-0: the scrollable chip strip must not widen the single column. */}
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-3">
          <DimensionNav items={navItems} />
        </div>

        <div className="min-w-0 lg:col-span-9 xl:col-span-8">
          <DimensionSections feedback={feedback} />
          <InterviewCta
            variant="full"
            resumeId={analysis.id}
            jobTitle={analysis.jobTitle}
            interview={analysis.interview}
          />
        </div>
      </div>
    </article>
  );
}
