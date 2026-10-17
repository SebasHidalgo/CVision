import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import {
  claimInterviewForFeedback,
  completeInterviewFeedback,
  failInterviewFeedback,
  releaseInterviewFeedback,
} from "./interviewFeedbackJob";

const tx = {
  interview: { updateMany: vi.fn() },
  interviewFeedback: { upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    interview: { updateMany: vi.fn(), findUnique: vi.fn() },
  },
}));

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const report = {} as InterviewFeedbackReport;
const guardStats = { counts: { "quote-dropped": 1 }, interventions: [{ check: "evidence-grounding", action: "quote-dropped", path: "notableAnswers[0].quote", value: "x" }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  tx.interview.updateMany.mockResolvedValue({ count: 1 });
  tx.interviewFeedback.upsert.mockResolvedValue({ id: "fb_1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the generator's writes when the interview was deleted under it", () => {
  it("completeInterviewFeedback writes nothing and answers null when the guarded update hits no row", async () => {
    tx.interview.updateMany.mockResolvedValue({ count: 0 });

    expect(await completeInterviewFeedback({ interviewId: INTERVIEW_ID, totalScore: 60, report, guardStats })).toBeNull();
    expect(tx.interviewFeedback.upsert).not.toHaveBeenCalled();
  });

  it("completeInterviewFeedback stores the feedback and the guard stats inside the same transaction when the claim still holds", async () => {
    expect(await completeInterviewFeedback({ interviewId: INTERVIEW_ID, totalScore: 60, report, guardStats })).toBe("fb_1");
    expect(tx.interview.updateMany).toHaveBeenCalledWith({
      where: { id: INTERVIEW_ID, status: "GENERATING" },
      data: { status: "COMPLETED", failureReason: null },
    });
    expect(tx.interviewFeedback.upsert).toHaveBeenCalledTimes(1);
    expect(tx.interviewFeedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { totalScore: 60, report, guardStats } }),
    );
  });

  it("claimInterviewForFeedback answers null when the row vanished between the claim and the read", async () => {
    vi.mocked(prisma.interview.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.interview.findUnique).mockResolvedValue(null);

    expect(await claimInterviewForFeedback(INTERVIEW_ID)).toBeNull();
  });

  it("release and fail report false, never throw, for a row that is gone", async () => {
    vi.mocked(prisma.interview.updateMany).mockResolvedValue({ count: 0 });

    expect(await releaseInterviewFeedback({ interviewId: INTERVIEW_ID, reason: "FEEDBACK_FAILED" })).toBe(false);
    expect(await failInterviewFeedback({ interviewId: INTERVIEW_ID, reason: "FEEDBACK_FAILED" })).toBe(false);
  });
});
