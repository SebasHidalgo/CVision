import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_CATEGORIES, type InterviewFeedbackReport } from "@/lib/ai/schemas";
import type { InterviewFeedback } from "@/types/interview";
import FeedbackReport from "./FeedbackReport";

// Link needs the app router at runtime; a plain anchor is enough to render.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const report: InterviewFeedbackReport = {
  gapFollowThrough: [
    {
      requirement: "Experience deploying and operating services on Kubernetes",
      outcome: "addressed",
      quote: "Last year we moved the six orders services to a managed Kubernetes cluster.",
      note: "Migration owned end to end.",
    },
    { requirement: "GraphQL API design", outcome: "dodged", quote: "", note: "Stayed at familiar with." },
    { requirement: "On-call rotation", outcome: "not_raised", quote: "", note: "Never asked." },
  ],
  notableAnswers: [
    { quote: "I rolled back the deploy first to stop the bleeding.", worked: true, why: "Own part and a result." },
    { quote: "I think I would handle it well.", worked: false, why: "No example." },
  ],
  categoryScores: FEEDBACK_CATEGORIES.map((name, i) => ({ name, score: 55 + i * 8, comment: `About ${name}.` })),
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
    candidateFloorSeconds: 301,
    longestTurnGapSeconds: 40,
    durationSeconds: 400,
    short: false,
  },
};

const feedback: InterviewFeedback = {
  id: "feedback_1",
  interviewId: "interview_1",
  role: "Backend Engineer",
  createdAt: "2026-10-11T10:00:00.000Z",
  totalScore: 71,
  report,
};

describe("FeedbackReport", () => {
  it("renders the gap follow-through first, with outcomes, quotes and anchored points", () => {
    const html = renderToStaticMarkup(
      <FeedbackReport
        feedback={feedback}
        transcript={[
          { role: "agent", message: "Tell me about the Kubernetes migration.", time_in_call_secs: 12 },
          { role: "user", message: "Last year we moved the six orders services to a managed Kubernetes cluster.", time_in_call_secs: 15 },
        ]}
        date="October 11, 2026"
      />,
    );

    // The lead section, one row per gap, with its outcome label and quote.
    const gaps = html.indexOf("Your weak spots, in the room");
    const readings = html.indexOf("Five readings");
    expect(gaps).toBeGreaterThan(-1);
    expect(gaps).toBeLessThan(readings);
    expect(html).toContain("Experience deploying and operating services on Kubernetes");
    expect(html).toContain("Addressed");
    expect(html).toContain("Dodged");
    expect(html).toContain("Not raised");
    expect(html).toContain("moved the six orders services to a managed Kubernetes cluster");

    // Notable answers with their verdicts.
    expect(html).toContain("Answers worth hearing again");
    expect(html).toContain("Worked");
    expect(html).toContain("Didn&#x27;t land");

    // Scores, stats line, prose.
    for (const name of FEEDBACK_CATEGORIES) expect(html).toContain(name);
    expect(html).toContain("6 answers · 70 words each · about 5 min speaking");
    expect(html).toContain("Specific where it counted; vague on GraphQL.");

    // A strength shows the words it rests on; a gap-anchored area shows the
    // requirement when the row has no quote; a dangling anchor shows the point alone.
    expect(html).toContain("Acts first under pressure");
    expect(html).toContain("rolled back the deploy first");
    expect(html).toContain("Bring a GraphQL example");
    expect(html).toContain("Dangling anchor is tolerated");

    // The transcript closes the page, collapsed, with speaker and time.
    const transcript = html.indexOf("<details");
    expect(transcript).toBeGreaterThan(html.indexOf("Final assessment"));
    expect(html).toContain("Tell me about the Kubernetes migration.");
    expect(html).toContain("0:15");
    expect(html).not.toContain("recording");
  });

  it("renders no transcript section when the row has none", () => {
    const html = renderToStaticMarkup(
      <FeedbackReport feedback={feedback} transcript={null} date="October 11, 2026" />,
    );
    expect(html).not.toContain("<details");
  });

  it("says so when the analysis found nothing to probe", () => {
    const html = renderToStaticMarkup(
      <FeedbackReport
        feedback={{ ...feedback, report: { ...report, gapFollowThrough: [] } }}
        transcript={null}
        date="October 11, 2026"
      />,
    );
    expect(html).toContain("The analysis found no gaps to probe.");
  });
});
