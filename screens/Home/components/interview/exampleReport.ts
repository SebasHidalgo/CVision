import type { TFunction } from "i18next";
import type { InterviewReportData } from "@/components/interview/feedback/InterviewReport";
import { CATEGORY_IDS, categoryName } from "@/components/interview/feedback/report";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import { INTERVIEW_TIERS, PLANS } from "@/lib/plans";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { ANSWERED_GAPS } from "@/screens/Home/utils/exampleCase";
import { clock, TALK_LINES } from "./talk";
import type { Script } from "./useTalkScript";

// The feedback the example conversation leads to, as the structure of the app's stored report. The report's own words
// are example.* in landingInterview.json; the labels are the app's (feedback namespace). `line` is the index of the
// talk line a row quotes or a point rests on; an anchor points into the report's own lists, as the app's do.

/** The candidate line said at a call time: where the example case's answered gaps sit in the conversation. */
export function answerLineAt(at: number): number {
  return TALK_LINES.findIndex((l) => l.who === "c" && l.at === at);
}

type ExampleOutcome = "addressed" | "partially";
const OUTCOME: Record<(typeof ANSWERED_GAPS)[number]["req"], ExampleOutcome> = { r3: "addressed", r5: "partially" };

export const EXAMPLE_REPORT = {
  /** Formatted in the reader's language. */
  date: "2026-11-17",
  /** The first rehearsal of the example analysis. */
  attempt: 1,
  total: 74,
  stats: { totalTurns: 19, answers: 9, wordsEach: 118, onFloorSeconds: 8 * 60, longestGapSeconds: 38, durationSeconds: 690 },
  /** One score per category, in the stored enum's order; their mean is the total, as the app computes it. */
  categories: [76, 72, 74, 78, 70],
  gaps: ANSWERED_GAPS.map((g) => ({ req: g.req, line: answerLineAt(g.at), outcome: OUTCOME[g.req] })),
  /** "Answers that stood out". */
  answers: [
    { id: "a1", line: 3, worked: true },
    { id: "a2", line: 7, worked: false },
  ],
  worked: [
    { id: "w1", line: 3, anchor: { source: "notableAnswers", index: 0 } },
    { id: "w2", line: 5, anchor: { source: "gapFollowThrough", index: 1 } },
  ],
  workOn: [
    { id: "o1", line: 7, anchor: { source: "notableAnswers", index: 1 } },
    { id: "o2", line: 5, anchor: { source: "gapFollowThrough", index: 1 } },
  ],
  /** The whole call's transcript; the report shows the excerpt's lines as its opening. */
  transcriptLines: 38,
} as const;

const R = EXAMPLE_REPORT;

/**
 * The example's report in the app's report shape, in the reader's language: what the landing's replica feeds the
 * shared report tree. Nothing navigates in the replica, so the links are null.
 */
export function exampleReportData({
  role,
  company,
  date,
  requirements,
  script,
  quoteOf,
  t,
  tl,
}: {
  role: string;
  company: string;
  /** R.date, formatted by the caller. */
  date: string;
  requirements: readonly LocalizedRequirement[];
  script: Script;
  /** The candidate's words of a talk line, as the report quotes them. */
  quoteOf: (line: number) => string;
  t: TFunction<"feedback">;
  tl: TFunction<"landingInterview">;
}): InterviewReportData {
  const report: InterviewFeedbackReport = {
    gapFollowThrough: R.gaps.map((g) => ({
      requirement: requirements.find((r) => r.id === g.req)?.text ?? g.req,
      outcome: g.outcome,
      quote: quoteOf(g.line),
      note: tl(`example.gaps.${g.req}`),
    })),
    notableAnswers: R.answers.map((a) => ({ quote: quoteOf(a.line), worked: a.worked, why: tl(`example.answers.${a.id}`) })),
    categoryScores: CATEGORY_IDS.map((id, i) => ({ name: categoryName(id), score: R.categories[i], comment: tl(`example.categories.${id}`) })),
    strengths: R.worked.map((p) => ({ point: tl(`example.worked.${p.id}`), anchor: { ...p.anchor } })),
    areasForImprovement: R.workOn.map((p) => ({ point: tl(`example.workOn.${p.id}`), anchor: { ...p.anchor } })),
    finalAssessment: tl("example.final"),
    totalScore: R.total,
    interviewStats: {
      totalTurns: R.stats.totalTurns,
      candidateTurns: R.stats.answers,
      candidateWords: R.stats.answers * R.stats.wordsEach,
      averageCandidateTurnWords: R.stats.wordsEach,
      candidateOnFloorSeconds: R.stats.onFloorSeconds,
      longestTurnGapSeconds: R.stats.longestGapSeconds,
      durationSeconds: R.stats.durationSeconds,
      plannedSeconds: INTERVIEW_TIERS.FULL.seconds,
      short: false,
    },
  };
  const perMonth = PLANS.PRO.interviewsPerMonth;
  return {
    role,
    date,
    company,
    attempt: R.attempt,
    totalScore: R.total,
    report,
    transcript: {
      entries: script.lines.map((l) => ({ kind: "line", key: l.id, who: l.who === "c" ? "candidate" : "interviewer", text: l.text, at: clock(l.at) })),
      lines: R.transcriptLines,
    },
    // The excerpt's call used one of a Pro period's interviews, all of them left before it (the room says so).
    next: { href: null, action: "again", note: t("next.note.period", { count: perMonth - 1, limit: perMonth }) },
    allInterviewsHref: null,
  };
}
