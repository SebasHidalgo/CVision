import { FEEDBACK_CATEGORIES, type InterviewFeedbackReport } from "@/lib/ai/schemas";
import type { InterviewReportData } from "./InterviewReport";
import { transcriptEntries } from "./transcript";

// Tests only: an invented report with every kind of row, and the report data around it.

export const REPORT: InterviewFeedbackReport = {
  gapFollowThrough: [
    {
      requirement: "Experience deploying and operating services on Kubernetes",
      outcome: "addressed",
      quote: "Last year we moved the six orders services to a managed Kubernetes cluster.",
      note: "Migration owned end to end.",
    },
    { requirement: "GraphQL API design", outcome: "dodged", quote: "", note: "Stayed at familiar with." },
    { requirement: "On-call rotation", outcome: "not_raised", quote: "", note: "Never asked." },
    { requirement: "Event-driven systems", outcome: "partially", quote: "We used a queue for the emails.", note: "Close, but small." },
  ],
  notableAnswers: [
    { quote: "I rolled back the deploy first to stop the bleeding.", worked: true, why: "Own part and a result." },
    { quote: "I think I would handle it well.", worked: false, why: "No example." },
  ],
  // Stored out of order: the page reads them in one fixed order.
  categoryScores: [...FEEDBACK_CATEGORIES].reverse().map((name, i) => ({ name, score: 55 + i * 8, comment: `About ${name}.` })),
  strengths: [{ point: "Acts first under pressure", anchor: { source: "notableAnswers", index: 0 } }],
  areasForImprovement: [
    { point: "Bring a GraphQL example", anchor: { source: "gapFollowThrough", index: 1 } },
    { point: "Dangling anchor is tolerated", anchor: { source: "notableAnswers", index: 9 } },
  ],
  finalAssessment: "Specific where it counted; vague on GraphQL.",
  totalScore: 71,
  interviewStats: {
    totalTurns: 12,
    candidateTurns: 6,
    candidateWords: 420,
    averageCandidateTurnWords: 70,
    candidateOnFloorSeconds: 301,
    longestTurnGapSeconds: 40,
    durationSeconds: 400,
    short: false,
  },
};

export const DATA: InterviewReportData = {
  role: "Backend Engineer",
  date: "October 11, 2026",
  company: "Northwind",
  attempt: 2,
  totalScore: 71,
  report: REPORT,
  transcript: transcriptEntries([
    { role: "agent", message: "Tell me about the Kubernetes migration.", time_in_call_secs: 12 },
    { role: "user", message: "Last year we moved the six orders services to a managed Kubernetes cluster.", time_in_call_secs: 15 },
    { role: "agent", message: "...", time_in_call_secs: 40 },
    { role: "system", message: "[call resumed]" },
    { role: "agent", message: "Welcome back. Where were we?", time_in_call_secs: 1 },
  ]),
  next: { href: "/resume/analysis/a1#interview-cta-title", action: "again", note: "3 of 4 interviews left this period" },
  allInterviewsHref: "/interviews",
};
