import { ANSWERED_GAPS } from "@/screens/Home/utils/exampleCase";
import { TALK_LINES } from "./talk";

// The feedback the example conversation leads to, shaped like the app's report. Structure only: the app's labels are
// app.feedback.* and the report's own words example.* in landingInterview.json. `line` is the index of the talk line
// a row quotes or a point rests on.

export const CATEGORY_IDS = ["communicationSkills", "technicalKnowledge", "problemSolving", "culturalFit", "confidenceAndClarity"] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export type GapOutcome = "addressed" | "partially";

/** The candidate line said at a call time: where the example case's answered gaps sit in the conversation. */
export function answerLineAt(at: number): number {
  return TALK_LINES.findIndex((l) => l.who === "c" && l.at === at);
}

const OUTCOME: Record<(typeof ANSWERED_GAPS)[number]["req"], GapOutcome> = { r3: "addressed", r5: "partially" };

export const EXAMPLE_REPORT = {
  /** Formatted in the reader's language. */
  date: "2026-11-17",
  total: 74,
  stats: { answers: 9, wordsEach: 118, onFloorMinutes: 8 },
  categories: [
    { id: "communicationSkills", score: 76 },
    { id: "technicalKnowledge", score: 72 },
    { id: "problemSolving", score: 74 },
    { id: "culturalFit", score: 78 },
    { id: "confidenceAndClarity", score: 70 },
  ] satisfies readonly { id: CategoryId; score: number }[],
  gaps: ANSWERED_GAPS.map((g) => ({ req: g.req, line: answerLineAt(g.at), outcome: OUTCOME[g.req] })),
  /** "Answers worth hearing again". */
  answers: [
    { id: "a1", line: 3, worked: true },
    { id: "a2", line: 7, worked: false },
  ],
  worked: [
    { id: "w1", line: 3 },
    { id: "w2", line: 5 },
  ],
  workOn: [
    { id: "o1", line: 7 },
    { id: "o2", line: 1 },
  ],
  /** The whole call's transcript; the report shows the excerpt's lines as its opening. */
  transcriptLines: 38,
} as const;
