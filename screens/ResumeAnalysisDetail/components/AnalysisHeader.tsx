import Eyebrow from "@/components/layout/Eyebrow";
import ScoreMeter from "@/components/score/ScoreMeter";
import ScoreReadout from "@/components/score/ScoreReadout";
import { FIT_LABEL } from "@/lib/score";
import type { ResumeAnalysis } from "@/types/resume";
import InterviewCta from "./InterviewCta";
import ResumeDrawer from "./ResumeDrawer";

type AnalysisHeaderProps = {
  companyName: string;
  jobTitle: string;
  /** Already formatted on the server. */
  date: string;
  score: number;
  summary: string;
  resumeUrl: string;
  resumeId: string;
  interview: ResumeAnalysis["interview"];
};

/** The dossier's cover: who, for what, and the one number that answers it. */
export default function AnalysisHeader({
  companyName,
  jobTitle,
  date,
  score,
  summary,
  resumeUrl,
  resumeId,
  interview,
}: AnalysisHeaderProps) {
  return (
    <header className="border-b border-line pb-10 lg:pb-12">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <Eyebrow tick>Analysis · {date}</Eyebrow>
          <p className="mt-6 text-lg text-ink-2">{companyName}</p>
          <h1 className="display-lg mt-1 text-ink">{jobTitle}</h1>
        </div>
        <div className="lg:col-span-5 lg:justify-self-end">
          <ScoreReadout score={score} size="xl" labels={FIT_LABEL} />
        </div>
      </div>

      <ScoreMeter
        score={score}
        size="lg"
        label="Overall fit"
        reveal="mount"
        delay={0.2}
        className="mt-8"
      />

      <div className="mt-10 grid gap-8 lg:grid-cols-12 lg:items-start">
        <p className="lede lg:col-span-8">{summary}</p>
        <div className="flex flex-wrap gap-3 lg:col-span-4 lg:justify-end">
          <ResumeDrawer resumeUrl={resumeUrl} title={`${jobTitle} · ${companyName}`} />
          <InterviewCta
            variant="compact"
            resumeId={resumeId}
            jobTitle={jobTitle}
            interview={interview}
          />
        </div>
      </div>
    </header>
  );
}
