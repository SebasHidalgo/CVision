import { redirect } from "next/navigation";
import HistoryNotice from "@/components/billing/HistoryNotice";
import ClientMessages from "@/components/i18n/ClientMessages";
import TranslationNotice from "@/components/i18n/TranslationNotice";
import TranslationPending from "@/components/i18n/TranslationPending";
import { localizedAnalysis } from "@/lib/ai/contentTranslation";
import { fetchResumeAccess } from "@/lib/database/resume";
import { currentUsageSummary, interviewQuotaView } from "@/lib/database/usage";
import { getLocale, getT } from "@/lib/i18n/server";
import { deriveFitVerdict } from "@/lib/schemas/resumeSchema";
import { formatLongDate } from "@/lib/format";
import AnalysisHeader from "./components/AnalysisHeader";
import DeleteAnalysis from "./components/DeleteAnalysis";
import DimensionNav from "./components/DimensionNav";
import DimensionSections from "./components/DimensionSections";
import InterviewAttempts from "./components/InterviewAttempts";
import InterviewCta from "./components/InterviewCta";
import PriorityFixes from "./components/PriorityFixes";
import { translateAnalysisAction } from "./actions/translateAnalysisAction";
import { DIMENSION_IDS, dimensionScores } from "./utils/dimensions";

type ResumeAnalysisDetailScreenProps = {
  resumeAnalysisId: string;
  /** Show the original prose without asking for a translation (after a translation call never got through). */
  original?: boolean;
};

export default async function ResumeAnalysisDetailScreen({
  resumeAnalysisId,
  original = false,
}: ResumeAnalysisDetailScreenProps) {
  // Already scoped to the owner: another user's analysis reads as missing.
  // The caller's own, beyond the plan's history, gets the notice instead.
  const [access, t, locale] = await Promise.all([fetchResumeAccess(resumeAnalysisId), getT("analysis"), getLocale()]);
  if (access.kind === "missing") redirect("/resume/analyses");
  if (access.kind === "hidden") return <HistoryNotice title={t("detail.historyTitle")} />;
  const { analysis } = access;

  // Stored feedback no longer matches the schema, so there is nothing to render.
  const { feedback: stored } = analysis;
  if (!stored) redirect("/resume/analyses");
  // Code-made sentences rendered in the page's language; the model's prose from its stored translation.
  const { feedback, state } = await localizedAnalysis(
    { id: analysis.id, companyName: analysis.companyName, jobTitle: analysis.jobTitle, feedback: stored },
    locale,
    { original },
  );
  // Never a page half in one language without saying so: no translation yet means "Translating…".
  if (state === "pending") return <TranslationPending translate={translateAnalysisAction} input={{ resumeId: analysis.id }} />;

  const scores = dimensionScores(feedback);
  const navItems = DIMENSION_IDS.map((id) => ({
    id,
    label: t(`dimensions.${id}.label`),
    score: scores[id],
  }));

  // What the interview control may offer: the trial, a Pro interview, or why not.
  const quota = interviewQuotaView(await currentUsageSummary());

  // The client components below (drawer, interview control, nav, delete) read the analysis namespace.
  return (
    <ClientMessages ns={["analysis"]}>
    <article className="wrap py-10 lg:py-14">
      <AnalysisHeader
        companyName={analysis.companyName}
        jobTitle={analysis.jobTitle}
        date={formatLongDate(analysis.createdAt, locale)}
        fit={deriveFitVerdict(feedback)}
        qualityScore={feedback.overall.qualityScore}
        summary={feedback.overall.summaryText}
        resumeId={analysis.id}
        attempts={analysis.interviews}
        quota={quota}
      />

      <TranslationNotice state={state} className="mt-8" />

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
            <InterviewAttempts attempts={analysis.interviews} t={t} locale={locale} />
          </InterviewCta>
          <DeleteAnalysis
            resumeId={analysis.id}
            jobTitle={analysis.jobTitle}
            companyName={analysis.companyName}
          />
        </div>
      </div>
    </article>
    </ClientMessages>
  );
}
