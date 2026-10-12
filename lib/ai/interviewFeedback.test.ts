import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimInterviewForFeedback,
  completeInterviewFeedback,
  failInterviewFeedback,
  releaseInterviewFeedback,
  type ClaimedInterview,
} from "@/lib/database/interviewFeedbackJob";
import { installFakeProvider, reply } from "./client.stub";
import { FEEDBACK_MAX_ATTEMPTS, generateInterviewFeedback } from "./interviewFeedback";
import { FEEDBACK_CATEGORIES } from "./schemas";

vi.mock("@/lib/database/interviewFeedbackJob", () => ({
  claimInterviewForFeedback: vi.fn(),
  releaseInterviewFeedback: vi.fn(async () => true),
  failInterviewFeedback: vi.fn(async () => true),
  completeInterviewFeedback: vi.fn(async () => "feedback_1"),
}));

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

const TURNS = [
  { role: "agent", message: "Hi Ana. Tell me about GraphQL.", time_in_call_secs: 0 },
  { role: "user", message: "Honestly I have only seen GraphQL in demos, but I built a REST API at Northwind.", time_in_call_secs: 4 },
  { role: "agent", message: "What did the API do?", time_in_call_secs: 30 },
  { role: "user", message: "It served the checkout, about two thousand orders a day.", time_in_call_secs: 34 },
];

const ANALYSIS = {
  overall: { qualityScore: 70, summaryText: "Meets most required items.", prioritizedFixes: [] },
  jobFit: {
    description: "Close.",
    requirements: [
      { requirement: "REST or GraphQL API design", kind: "required", status: "met", evidence: "Built a REST API", note: "" },
      { requirement: "GraphQL schema design", kind: "preferred", status: "missing", evidence: "", note: "Nothing on GraphQL." },
    ],
    strategicRecommendations: [],
  },
};

function claimed(overrides: Partial<ClaimedInterview> = {}): ClaimedInterview {
  return {
    id: INTERVIEW_ID,
    role: "Backend Engineer",
    transcript: TURNS,
    transcriptSource: "elevenlabs",
    issuedContext: { candidate_name: "Ana", language_name: "English" },
    durationSeconds: 60,
    feedbackAttempts: 1,
    resumeAnalysis: {
      jobTitle: "Backend Engineer",
      companyName: "Northwind",
      jobDescription: "Design APIs in REST or GraphQL for the checkout team.",
      feedback: ANALYSIS,
    },
    ...overrides,
  };
}

/** A valid model answer whose quotes are spans of the candidate turns. */
const answer = (overrides: Record<string, unknown> = {}) => ({
  gapFollowThrough: [
    { requirement: "GraphQL schema design", outcome: "dodged", quote: "I have only seen GraphQL in demos", note: "Demos only." },
  ],
  notableAnswers: [
    { quote: "I built a REST API at Northwind.", worked: true, why: "Concrete." },
    { quote: "about two thousand orders a day", worked: true, why: "A real figure." },
  ],
  categoryScores: FEEDBACK_CATEGORIES.map((name, i) => ({ name, score: 50 + i * 5, comment: `About ${name}.` })),
  strengths: [{ point: "Names what they built", anchor: { source: "notableAnswers", index: 0 } }],
  areasForImprovement: [{ point: "Bring a GraphQL example", anchor: { source: "gapFollowThrough", index: 0 } }],
  finalAssessment: "Short interview; low-confidence scores. Specific when asked about the API.",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimInterviewForFeedback).mockResolvedValue(claimed());
  vi.mocked(completeInterviewFeedback).mockResolvedValue("feedback_1");
  for (const method of ["info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

describe("generateInterviewFeedback: the happy path", () => {
  it("claims, scores, guards and completes, with the total and stats computed in code", async () => {
    const { requests } = installFakeProvider(() => reply.json(answer()));

    const outcome = await generateInterviewFeedback(INTERVIEW_ID);

    expect(outcome).toEqual({ kind: "completed", feedbackId: "feedback_1" });
    expect(requests).toHaveLength(1);
    expect(completeInterviewFeedback).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      totalScore: 60,
      report: expect.objectContaining({
        totalScore: 60,
        interviewStats: expect.objectContaining({ candidateTurns: 2, totalTurns: 4, short: true, durationSeconds: 60 }),
        gapFollowThrough: [expect.objectContaining({ outcome: "dodged", quote: "I have only seen GraphQL in demos" })],
      }),
    });
    expect(failInterviewFeedback).not.toHaveBeenCalled();
    expect(releaseInterviewFeedback).not.toHaveBeenCalled();
  });

  it("builds the prompt from stored context: labeled turns, the gap list, the name, the stats", async () => {
    const { requests } = installFakeProvider(() => reply.json(answer()));

    await generateInterviewFeedback(INTERVIEW_ID);

    const [request] = requests;
    expect(request.system).toContain("RULE 2");
    expect(request.prompt).toContain("CANDIDATE [0:04]: Honestly I have only seen GraphQL");
    expect(request.prompt).toContain("INTERVIEWER [0:00]: Hi Ana.");
    expect(request.prompt).toContain("1. GraphQL schema design");
    expect(request.prompt).toContain("first name: Ana");
    expect(request.prompt).toContain("Candidate turns: 2 of 4");
    expect(request.prompt).toContain("Company: Northwind");
  });

  it("drops a quote the candidate never said and records it, before persisting", async () => {
    installFakeProvider(() =>
      reply.json(answer({ notableAnswers: [{ quote: "I designed GraphQL schemas for years", worked: true, why: "x" }] })),
    );
    const warned = vi.mocked(console.warn);

    await generateInterviewFeedback(INTERVIEW_ID);

    const [{ report }] = vi.mocked(completeInterviewFeedback).mock.calls[0];
    expect(report.notableAnswers[0].quote).toBe("");
    expect(warned.mock.calls.flat().join("\n")).toContain("guardrail fired: quote-dropped 1");
  });
});

describe("generateInterviewFeedback: claiming", () => {
  it("does nothing, and pays nothing, when the row cannot be claimed", async () => {
    vi.mocked(claimInterviewForFeedback).mockResolvedValue(null);
    const { requests } = installFakeProvider(() => reply.json(answer()));

    expect(await generateInterviewFeedback(INTERVIEW_ID)).toEqual({ kind: "skipped" });
    expect(requests).toHaveLength(0);
    expect(completeInterviewFeedback).not.toHaveBeenCalled();
  });

  it("two concurrent calls produce one model call: the claim decides", async () => {
    vi.mocked(claimInterviewForFeedback)
      .mockResolvedValueOnce(claimed())
      .mockResolvedValueOnce(null);
    const { requests } = installFakeProvider(() => reply.json(answer()));

    const outcomes = await Promise.all([
      generateInterviewFeedback(INTERVIEW_ID),
      generateInterviewFeedback(INTERVIEW_ID),
    ]);

    expect(outcomes.map((o) => o.kind).sort()).toEqual(["completed", "skipped"]);
    expect(requests).toHaveLength(1);
    expect(completeInterviewFeedback).toHaveBeenCalledTimes(1);
  });

  it("reports skipped when the guarded completion finds the claim gone", async () => {
    vi.mocked(completeInterviewFeedback).mockResolvedValue(null);
    installFakeProvider(() => reply.json(answer()));

    expect(await generateInterviewFeedback(INTERVIEW_ID)).toEqual({ kind: "skipped" });
  });
});

describe("generateInterviewFeedback: failures", () => {
  it("fails a row with no readable transcript without calling the model", async () => {
    vi.mocked(claimInterviewForFeedback).mockResolvedValue(claimed({ transcript: null }));
    const { requests } = installFakeProvider(() => reply.json(answer()));

    expect(await generateInterviewFeedback(INTERVIEW_ID)).toEqual({ kind: "failed", reason: "TRANSCRIPT_INVALID" });
    expect(failInterviewFeedback).toHaveBeenCalledWith({ interviewId: INTERVIEW_ID, reason: "TRANSCRIPT_INVALID" });
    expect(requests).toHaveLength(0);
  });

  it("fails a transcript with no candidate turns", async () => {
    vi.mocked(claimInterviewForFeedback).mockResolvedValue(
      claimed({ transcript: [{ role: "agent", message: "Hello?", time_in_call_secs: 0 }] }),
    );
    installFakeProvider(() => reply.json(answer()));

    expect(await generateInterviewFeedback(INTERVIEW_ID)).toEqual({ kind: "failed", reason: "NO_CANDIDATE_TURNS" });
  });

  it("fails when there is no analysis to judge against", async () => {
    vi.mocked(claimInterviewForFeedback).mockResolvedValue(
      claimed({ resumeAnalysis: { ...claimed().resumeAnalysis!, feedback: null } }),
    );
    installFakeProvider(() => reply.json(answer()));

    expect(await generateInterviewFeedback(INTERVIEW_ID)).toEqual({ kind: "failed", reason: "CONTEXT_MISSING" });
  });

  it("hands the row back with a reason when the provider fails and an attempt remains", async () => {
    vi.mocked(claimInterviewForFeedback).mockResolvedValue(claimed({ feedbackAttempts: 1 }));
    installFakeProvider(() => reply.error(503));

    expect(await generateInterviewFeedback(INTERVIEW_ID)).toEqual({ kind: "retry-later", code: "AI_UNAVAILABLE" });
    expect(releaseInterviewFeedback).toHaveBeenCalledWith({ interviewId: INTERVIEW_ID, reason: "FEEDBACK_FAILED" });
    expect(failInterviewFeedback).not.toHaveBeenCalled();
  });

  it("gives up on the second failed attempt", async () => {
    vi.mocked(claimInterviewForFeedback).mockResolvedValue(claimed({ feedbackAttempts: FEEDBACK_MAX_ATTEMPTS }));
    installFakeProvider(() => reply.json({ not: "the schema" }));

    expect(await generateInterviewFeedback(INTERVIEW_ID)).toEqual({
      kind: "failed",
      reason: "FEEDBACK_FAILED",
      code: "AI_BAD_FORMAT",
    });
    expect(failInterviewFeedback).toHaveBeenCalledWith({ interviewId: INTERVIEW_ID, reason: "FEEDBACK_FAILED" });
    expect(releaseInterviewFeedback).not.toHaveBeenCalled();
  });
});
