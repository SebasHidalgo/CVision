import { redirect } from "next/navigation";
import { fetchResumeById } from "@/lib/database/resume";
import { currentUsageSummary, interviewQuotaView } from "@/lib/database/usage";
import { deriveFitVerdict } from "@/lib/schemas/resumeSchema";
import { formatLongDate } from "@/lib/format";
import AnalysisHeader from "./components/AnalysisHeader";
import DeleteAnalysis from "./components/DeleteAnalysis";
import DimensionNav from "./components/DimensionNav";
import DimensionSections from "./components/DimensionSections";
import InterviewAttempts from "./components/InterviewAttempts";
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

  // What the interview control may offer: the trial, a Pro interview, or why not.
  const quota = interviewQuotaView(await currentUsageSummary());

  return (
    <article className="wrap py-10 lg:py-14">
      <AnalysisHeader
        companyName={analysis.companyName}
        jobTitle={analysis.jobTitle}
        date={formatLongDate(analysis.createdAt)}
        fit={deriveFitVerdict(feedback)}
        qualityScore={feedback.overall.qualityScore}
        summary={feedback.overall.summaryText}
        resumeId={analysis.id}
        attempts={analysis.interviews}
        quota={quota}
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
            attempts={analysis.interviews}
            quota={quota}
          >
            <InterviewAttempts attempts={analysis.interviews} />
          </InterviewCta>
          <DeleteAnalysis
            resumeId={analysis.id}
            jobTitle={analysis.jobTitle}
            companyName={analysis.companyName}
          />
        </div>
      </div>
    </article>
  );
}
