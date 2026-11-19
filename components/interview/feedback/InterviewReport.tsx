import type { TFunction } from "i18next";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import { FinalAssessment, RehearseAgain, TranscriptFold, type RehearseNext } from "./Closing";
import { GapFollowThrough } from "./GapFollowThrough";
import { NotableAnswers } from "./NotableAnswers";
import { plainProse, sub, type ProseRenderer } from "./parts";
import { Points, Readings } from "./Readings";
import { quotedAnswers } from "./report";
import { ReportHeader } from "./ReportHeader";
import type { ReportTranscript } from "./transcript";

/** What a feedback report shows: the app's stored report, or the landing's example shaped the same way. */
export type InterviewReportData = {
  role: string;
  /** Formatted by the caller, in the reader's language. */
  date: string;
  company: string | null;
  attempt: number | null;
  totalScore: number;
  /** The model's prose may be PENDING_PROSE while its translation is on its way: it renders as a skeleton. */
  report: InterviewFeedbackReport;
  transcript: ReportTranscript | null;
  /** Null when there is nowhere to rehearse from (the interview lost its analysis). */
  next: RehearseNext | null;
  /** Null in the landing's replica: the words without the link. */
  allInterviewsHref: string | null;
};

export type InterviewReportProps = InterviewReportData & {
  t: TFunction<"feedback">;
  common: TFunction<"common">;
  /** Inside the landing's section: headings start at h3 and the head steps down a size. */
  embedded?: boolean;
  /** Makes the section ids unique on the page. */
  idPrefix?: string;
  /** Between the head and the report: the translation's status line. */
  notice?: React.ReactNode;
  /** Above the transcript's lines. */
  transcriptNote?: React.ReactNode;
  /** How the model's prose renders; the page passes the one that shows a skeleton while a translation is on its way. */
  prose?: ProseRenderer;
};

/**
 * The interview feedback report, one tree for the feedback page and the landing's replica of it. Server-renderable
 * (no hooks, no "use client"): the page passes its server `t`, the landing its client one, and the same props give
 * the same markup.
 */
export function InterviewReport({
  role,
  date,
  company,
  attempt,
  totalScore,
  report,
  transcript,
  next,
  allInterviewsHref,
  t,
  common,
  embedded = false,
  idPrefix = "feedback",
  notice,
  transcriptNote,
  prose = plainProse,
}: InterviewReportProps) {
  const level = embedded ? 3 : 1;
  const sections = sub(level);
  const ids = (part: string) => `${idPrefix}-${part}`;
  const answers = quotedAnswers(report);

  return (
    <article aria-labelledby={ids("title")} data-feedback-report>
      <ReportHeader
        role={role}
        date={date}
        company={company}
        attempt={attempt}
        totalScore={totalScore}
        stats={report.interviewStats}
        allInterviewsHref={allInterviewsHref}
        level={level}
        embedded={embedded}
        titleId={ids("title")}
        t={t}
        common={common}
      />
      {notice}
      <GapFollowThrough rows={report.gapFollowThrough} id={ids("gaps")} level={sections} embedded={embedded} prose={prose} t={t} />
      {answers.length > 0 && <NotableAnswers answers={answers} id={ids("answers")} level={sections} embedded={embedded} prose={prose} t={t} />}
      <Readings report={report} id={ids("readings")} level={sections} embedded={embedded} prose={prose} t={t} common={common} />
      <Points report={report} id={ids("points")} level={sections} embedded={embedded} prose={prose} t={t} />
      <FinalAssessment text={report.finalAssessment} id={ids("final")} level={sections} embedded={embedded} prose={prose} t={t} />
      {transcript && <TranscriptFold transcript={transcript} note={transcriptNote} t={t} />}
      {next && <RehearseAgain next={next} id={ids("next")} level={sections} t={t} />}
    </article>
  );
}
