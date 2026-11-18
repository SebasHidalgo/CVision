import { redirect } from "next/navigation";
import { fontText } from "@/components/design-system/fonts";
import ClientMessages from "@/components/i18n/ClientMessages";
import { localizedAnalysis } from "@/lib/ai/contentTranslation";
import { fetchResumeAccess } from "@/lib/database/resume";
import { currentUsageSummary, interviewQuotaView } from "@/lib/database/usage";
import { formatLongDate } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { deriveFitVerdict } from "@/lib/schemas/resumeSchema";
import { cn } from "@/lib/utils";
import AnalysisHeader from "./components/AnalysisHeader";
import DeleteAnalysis from "./components/DeleteAnalysis";
import DimensionNav from "./components/DimensionNav";
import DimensionSections from "./components/DimensionSections";
import HiddenAnalysis from "./components/HiddenAnalysis";
import InterviewAttempts from "./components/InterviewAttempts";
import InterviewCta from "./components/InterviewCta";
import PriorityFixes from "./components/PriorityFixes";
import TranslationLine from "./components/TranslationLine";
import { DIMENSION_IDS, dimensionScores } from "./utils/dimensions";

type ResumeAnalysisDetailScreenProps = {
  resumeAnalysisId: string;
  /** Show the original prose without asking for a translation (after a translation call never got through). */
  original?: boolean;
};

/** The page root of the new design: the plain dark canvas (no moving ground on a working page). */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("ed-root flex-1", fontText.variable)}>
      <article className="ed-wrap pt-[clamp(32px,5vw,64px)] pb-ed-section">{children}</article>
    </div>
  );
}

export default async function ResumeAnalysisDetailScreen({
  resumeAnalysisId,
  original = false,
}: ResumeAnalysisDetailScreenProps) {
  // Already scoped to the owner: another user's analysis reads as missing.
  // The caller's own, beyond the plan's history, gets the notice instead.
  const [access, t, locale] = await Promise.all([fetchResumeAccess(resumeAnalysisId), getT("analysis"), getLocale()]);
  if (access.kind === "missing") redirect("/resume/analyses");
  if (access.kind === "hidden") {
    return (
      <Page>
        <HiddenAnalysis title={t("detail.historyTitle")} />
      </Page>
    );
  }
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
      <Page>
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

        {/* No translation yet: the prose shows skeletons and this line asks for it; never a page half in one language unannounced. */}
        <TranslationLine state={state} resumeId={analysis.id} className="mt-10" />

        <PriorityFixes fixes={feedback.overall.prioritizedFixes} className="mt-[clamp(56px,7vw,96px)]" />

        {/* A block on small screens, so the sticky section strip (whose wrapper is `contents` there) sticks through
            the whole report; the 12-column grid from lg, the index in the first three columns. */}
        <div className="mt-[clamp(56px,7vw,96px)] lg:grid lg:grid-cols-12 lg:gap-x-ed-gutter">
          <div className="contents lg:col-span-3 lg:block">
            <DimensionNav items={navItems} />
          </div>

          <div className="min-w-0 lg:col-span-9">
            <DimensionSections feedback={feedback} />
            <InterviewCta variant="full" resumeId={analysis.id} jobTitle={analysis.jobTitle} attempts={analysis.interviews} quota={quota}>
              <InterviewAttempts attempts={analysis.interviews} t={t} locale={locale} entitlement={quota.entitlement} />
            </InterviewCta>
            <DeleteAnalysis resumeId={analysis.id} jobTitle={analysis.jobTitle} companyName={analysis.companyName} />
          </div>
        </div>
      </Page>
    </ClientMessages>
  );
}
