import Prose from "@/components/i18n/Prose";
import { getT } from "@/lib/i18n/server";
import type { InterviewQuotaView } from "@/lib/plans";
import type { FitVerdict } from "@/lib/schemas/resumeSchema";
import { scoreTone, toneKey } from "@/lib/score";
import type { ResumeAnalysis } from "@/types/resume";
import InterviewCta from "./InterviewCta";
import ResumeDrawer from "./ResumeDrawer";
import { ScoreBar } from "./ScoreBar";
import { VerdictCard } from "./VerdictCard";

type AnalysisHeaderProps = {
  companyName: string;
  jobTitle: string;
  /** Already formatted on the server. */
  date: string;
  fit: FitVerdict;
  qualityScore: number;
  summary: string;
  resumeId: string;
  attempts: ResumeAnalysis["interviews"];
  quota: InterviewQuotaView;
};

/**
 * The cover. Fit answers "this posting" and quality answers "this document": the verdict card on the right, the
 * quality reading under the summary. On a phone the verdict comes right after the title.
 */
export default async function AnalysisHeader({
  companyName,
  jobTitle,
  date,
  fit,
  qualityScore,
  summary,
  resumeId,
  attempts,
  quota,
}: AnalysisHeaderProps) {
  const [t, common] = await Promise.all([getT("analysis"), getT("common")]);

  return (
    <header className="page-grid gap-y-8 lg:grid-rows-[auto_1fr] lg:gap-y-10">
      <div className="lg:col-[1/span_8] lg:row-start-1">
        <p className="cap">{t("header.eyebrow", { date })}</p>
        <p className="mt-6 text-[18px] text-ink-2">{companyName}</p>
        <h1 className="display mt-1.5 text-[clamp(38px,4.6vw,68px)] leading-[1.02] tracking-[-0.03em] text-balance break-words">
          {jobTitle}
        </h1>
      </div>

      <VerdictCard verdict={fit} t={t} common={common} className="max-lg:max-w-[34rem] lg:col-[9/span_4] lg:row-[1/span_2] lg:self-start" />

      <div className="lg:col-[1/span_7] lg:row-start-2">
        <p className="max-w-[62ch] text-lede text-ink">
          <Prose text={summary} lines={3} />
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <ResumeDrawer resumeId={resumeId} title={`${jobTitle} · ${companyName}`} />
          <InterviewCta variant="compact" resumeId={resumeId} jobTitle={jobTitle} attempts={attempts} quota={quota} />
        </div>

        <section aria-labelledby="quality-title" className="mt-12 max-w-[26rem] border-t border-line-2 pt-4">
          <h2 id="quality-title" className="cap">
            {t("header.quality")}
          </h2>
          <p className="mt-3 flex items-baseline gap-3">
            <span className="mono text-[40px] leading-none text-ink">{qualityScore}</span>
            <span className="text-[15px] text-ink-2">{common("score.outOf")}</span>
          </p>
          <ScoreBar score={qualityScore} label={t("header.qualityMeter")} className="mt-4" />
          <p className="mt-3 text-[15px] text-ink-2">
            {t("header.qualityNote", { tone: common(toneKey("tone", scoreTone(qualityScore))) })}
          </p>
        </section>
      </div>
    </header>
  );
}
