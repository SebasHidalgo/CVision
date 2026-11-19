import type { TFunction } from "i18next";
import Prose from "@/components/i18n/Prose";
import { InterviewReport, type InterviewReportData } from "@/components/interview/feedback/InterviewReport";
import type { ProseRenderer } from "@/components/interview/feedback/parts";
import { transcriptEntries } from "@/components/interview/feedback/transcript";
import { formatLongDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import type { TranscriptTurn } from "@/lib/voice/transcript";
import type { InterviewFeedback } from "@/types/interview";
import type { NotePart, RehearseNote } from "../utils/rehearseNote";

type FeedbackReportProps = {
  feedback: InterviewFeedback;
  /** The stored turns the report quotes from; null when the row has none. */
  transcript: TranscriptTurn[] | null;
  /** Already formatted on the server. */
  date: string;
  company: string | null;
  attempt: number;
  /** The analysis it rehearses: where the next attempt starts. Null when it is gone. */
  analysisId: string | null;
  /** What the plan has left for that attempt; null when it was not read. */
  rehearse: RehearseNote | null;
  locale: Locale;
  /** The translation's status line, under the head. */
  notice?: React.ReactNode;
};

function noteText(part: NotePart, t: TFunction<"feedback">, locale: Locale): string {
  switch (part.key) {
    case "period":
      return t("next.note.period", { count: part.count, limit: part.limit });
    case "credits":
      return t("next.note.credits", { count: part.count });
    case "creditsLeft":
      return t("next.note.creditsLeft", { count: part.count });
    case "trial":
      return t("next.note.trial", { minutes: part.minutes });
    case "periodUsed":
      return t("next.note.periodUsed", { date: formatLongDate(part.resetsAt, locale) });
    case "needsPro":
      return t("next.note.needsPro");
  }
}

/** The model's prose, or its skeleton while the translation is on its way. */
const proseOrSkeleton: ProseRenderer = (text, lines) => <Prose text={text} lines={lines} />;

/** The page's data in the shared report's shape; the landing builds the same shape from its example. */
export function feedbackReportData(props: Omit<FeedbackReportProps, "notice">, t: TFunction<"feedback">): InterviewReportData {
  const { feedback, transcript, date, company, attempt, analysisId, rehearse, locale } = props;
  return {
    role: feedback.role,
    date,
    company,
    attempt,
    totalScore: feedback.totalScore,
    report: feedback.report,
    transcript: transcript ? transcriptEntries(transcript) : null,
    next: analysisId
      ? {
          href: `/resume/analysis/${analysisId}#interview-cta-title`,
          action: rehearse && !rehearse.canStart ? "analysis" : "again",
          note: rehearse ? rehearse.parts.map((part) => noteText(part, t, locale)).join(" · ") : null,
        }
      : null,
    allInterviewsHref: "/interviews",
  };
}

/** The report of a completed interview: the shared report tree, fed from the stored feedback. */
export default async function FeedbackReport({ notice, ...props }: FeedbackReportProps) {
  const [t, common] = await Promise.all([getT("feedback"), getT("common")]);
  return <InterviewReport {...feedbackReportData(props, t)} t={t} common={common} notice={notice} prose={proseOrSkeleton} />;
}
