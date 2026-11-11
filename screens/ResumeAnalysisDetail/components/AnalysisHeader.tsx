import Eyebrow from "@/components/layout/Eyebrow";
import ScoreMeter from "@/components/score/ScoreMeter";
import VerdictReadout from "@/components/score/VerdictReadout";
import { getT } from "@/lib/i18n/server";
import type { InterviewQuotaView } from "@/lib/plans";
import type { FitVerdict } from "@/lib/schemas/resumeSchema";
import { scoreTone, TONE_CLASS, toneKey } from "@/lib/score";
import type { ResumeAnalysis } from "@/types/resume";
import InterviewCta from "./InterviewCta";
import ResumeDrawer from "./ResumeDrawer";
import Prose from "@/components/i18n/Prose";

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
 * The dossier cover. Fit answers "this posting" and quality answers "this
 * document". Fit is a verdict rather than a number because it is derived from
 * the requirements breakdown, and the breakdown only supports three outcomes -
 * a 0-100 there would claim a precision we do not have. Its counts are printed
 * beside it so the arithmetic is open to inspection.
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
  const qualityTone = scoreTone(qualityScore);

  return (
    <header className="border-b border-line pb-10 lg:pb-12">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <Eyebrow tick>{t("header.eyebrow", { date })}</Eyebrow>
          <p className="mt-6 text-lg text-ink-2">{companyName}</p>
          <h1 className="display-lg mt-1 text-ink">{jobTitle}</h1>
        </div>
        <div className="lg:col-span-5 lg:justify-self-end">
          <VerdictReadout verdict={fit} />
        </div>
      </div>



      <div className="mt-10 flex items-center gap-4 sm:max-w-md">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="eyebrow">{t("header.quality")}</h2>
            <span className="figure text-2xl text-ink tabular">{qualityScore}</span>
          </div>
          <ScoreMeter
            score={qualityScore}
            size="sm"
            label={t("header.qualityMeter")}
            reveal="mount"
            delay={0.3}
            className="mt-2"
          />
          <p className={`mt-1.5 text-xs font-medium ${TONE_CLASS[qualityTone].text}`}>
            {t("header.qualityNote", { tone: common(toneKey("tone", qualityTone)) })}
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-12 lg:items-start">
        <p className="lede lg:col-span-8">
          <Prose text={summary} lines={3} />
        </p>
        <div className="flex flex-wrap gap-3 lg:col-span-4 lg:justify-end">
          <ResumeDrawer resumeId={resumeId} title={`${jobTitle} · ${companyName}`} />
          <InterviewCta
            variant="compact"
            resumeId={resumeId}
            jobTitle={jobTitle}
            attempts={attempts}
            quota={quota}
          />
        </div>
      </div>
    </header>
  );
}
