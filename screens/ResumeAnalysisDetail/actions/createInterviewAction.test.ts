import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInterview } from "@/lib/database/interview";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { fetchResumeById } from "@/lib/database/resume";
import { usageSummary, type UsageSummary } from "@/lib/database/usage";
import { RateLimitedError } from "@/lib/error/errors";
import { MAX_TECHSTACK_ITEM_CHARS, MAX_TECHSTACK_ITEMS } from "@/lib/schemas/interviewSchema";
import type { ResumeAnalysis } from "@/types/resume";
import { createInterviewAction } from "./createInterviewAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/database/user", () => ({ ensureUser: vi.fn(async () => "user_1") }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/database/usage", () => ({ usageSummary: vi.fn() }));
vi.mock("@/lib/database/resume", () => ({ fetchResumeById: vi.fn() }));
vi.mock("@/lib/database/interview", () => ({ createInterview: vi.fn() }));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

function resumeWith(
  matchedSkills: { name: string; evidence: string }[],
  overrides: Partial<ResumeAnalysis> = {},
): ResumeAnalysis {
  return {
    id: RESUME_ID,
    companyName: "Northwind",
    jobTitle: "Frontend Engineer",
    jobDescription: "React, TypeScript, testing.",
    resumeKey: "cv/user_1/11111111-2222-4333-8444-555555555555.pdf",
    userId: "user_1",
    createdAt: "2026-10-01T00:00:00.000Z",
    interviews: [],
    feedback: {
      skills: { matchedSkills },
    } as unknown as ResumeAnalysis["feedback"],
    ...overrides,
  };
}

const attempt = (id: string, status: ResumeAnalysis["interviews"][number]["status"], attemptNumber: number) => ({
  id,
  status,
  attemptNumber,
  totalScore: status === "COMPLETED" ? 60 : null,
  createdAt: "2026-10-01T00:00:00.000Z",
});

const summary = (overrides: Partial<UsageSummary> = {}): UsageSummary => ({
  plan: "FREE",
  source: "free",
  analyses: { used: 1, limit: 3, left: 2, announce: true },
  interviews: { used: 0, limit: 0, left: 0 },
  credits: { balance: 0, usable: false },
  trial: { available: true, used: false },
  period: { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") },
  resetsAt: new Date("2026-11-01T00:00:00Z"),
  subscription: null,
  everSubscribed: false,
  hasBillingAccount: false,
  ...overrides,
});

beforeEach(() => {
  // restoreMocks only restores spies; call history on vi.fn() survives it.
  vi.clearAllMocks();
  vi.mocked(assertRateLimit).mockResolvedValue(undefined);
  vi.mocked(usageSummary).mockResolvedValue(summary());
  vi.mocked(createInterview).mockResolvedValue({ id: "interview_1", attemptNumber: 1, created: true });
  // The action logs failures server-side; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createInterviewAction: chips come from the stored analysis", () => {
  it("uses the matched skill names, deduplicated, without any model call", async () => {
    vi.mocked(fetchResumeById).mockResolvedValue(
      resumeWith([
        { name: "React", evidence: "React" },
        { name: " TypeScript ", evidence: "TS" },
        { name: "react", evidence: "again" },
      ]),
    );

    const result = await createInterviewAction({ resumeId: RESUME_ID });

    expect(result).toEqual({ ok: true, data: { interviewId: "interview_1" } });
    expect(createInterview).toHaveBeenCalledWith({
      role: "Frontend Engineer",
      techstack: ["React", "TypeScript"],
      resumeId: RESUME_ID,
    });
    const { ensureUser } = await import("@/lib/database/user");
    expect(ensureUser).toHaveBeenCalledTimes(1);
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "interviewCreate");
  });

  it("drops names too long for a chip and stops at the item cap", async () => {
    const many = Array.from({ length: MAX_TECHSTACK_ITEMS + 5 }, (_, i) => ({
      name: `Skill ${i}`,
      evidence: "",
    }));
    vi.mocked(fetchResumeById).mockResolvedValue(
      resumeWith([{ name: "x".repeat(MAX_TECHSTACK_ITEM_CHARS + 1), evidence: "" }, ...many]),
    );

    await createInterviewAction({ resumeId: RESUME_ID });

    const { techstack } = vi.mocked(createInterview).mock.calls[0][0];
    expect(techstack).toHaveLength(MAX_TECHSTACK_ITEMS);
    expect(techstack[0]).toBe("Skill 0");
  });

  it("creates the interview with no chips when the analysis has no feedback", async () => {
    vi.mocked(fetchResumeById).mockResolvedValue(resumeWith([], { feedback: null }));

    const result = await createInterviewAction({ resumeId: RESUME_ID });

    expect(result).toEqual({ ok: true, data: { interviewId: "interview_1" } });
    expect(createInterview).toHaveBeenCalledWith(
      expect.objectContaining({ techstack: [] }),
    );
  });
});

describe("createInterviewAction: guards", () => {
  it.each(["SCHEDULED", "IN_PROGRESS"] as const)(
    "returns the live %s attempt instead of creating another, without consulting the quota",
    async (status) => {
      vi.mocked(fetchResumeById).mockResolvedValue(
        resumeWith([], { interviews: [attempt("interview_2", status, 2), attempt("interview_1", "COMPLETED", 1)] }),
      );

      const result = await createInterviewAction({ resumeId: RESUME_ID });

      expect(result).toEqual({ ok: true, data: { interviewId: "interview_2" } });
      expect(createInterview).not.toHaveBeenCalled();
      expect(usageSummary).not.toHaveBeenCalled();
    },
  );

  it.each(["COMPLETED", "FAILED", "FEEDBACK_PENDING"] as const)(
    "creates the next attempt when the latest is %s, however many there were",
    async (status) => {
      vi.mocked(fetchResumeById).mockResolvedValue(
        resumeWith([], { interviews: [attempt("i3", status, 3), attempt("i2", "COMPLETED", 2), attempt("i1", "COMPLETED", 1)] }),
      );
      vi.mocked(createInterview).mockResolvedValue({ id: "i4", attemptNumber: 4, created: true });

      const result = await createInterviewAction({ resumeId: RESUME_ID });

      expect(result).toEqual({ ok: true, data: { interviewId: "i4" } });
      expect(createInterview).toHaveBeenCalledTimes(1);
    },
  );

  it("answers NOT_FOUND for a missing or foreign analysis", async () => {
    vi.mocked(fetchResumeById).mockResolvedValue(null);

    const result = await createInterviewAction({ resumeId: RESUME_ID });

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(createInterview).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a uuid before touching the database", async () => {
    const result = await createInterviewAction({ resumeId: "not-a-uuid" });

    expect(result).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(fetchResumeById).not.toHaveBeenCalled();
  });

  it("answers RATE_LIMITED before reading anything", async () => {
    vi.mocked(assertRateLimit).mockRejectedValue(new RateLimitedError(600));

    expect(await createInterviewAction({ resumeId: RESUME_ID })).toEqual({ ok: false, code: "RATE_LIMITED", meta: { retryAfter: 600 } });
    expect(fetchResumeById).not.toHaveBeenCalled();
  });
});

describe("createInterviewAction: the plan's unit is checked, not reserved", () => {
  beforeEach(() => {
    vi.mocked(fetchResumeById).mockResolvedValue(resumeWith([]));
  });

  it("creates when a Free account still has its trial, and refuses once it is used", async () => {
    expect((await createInterviewAction({ resumeId: RESUME_ID })).ok).toBe(true);

    vi.mocked(usageSummary).mockResolvedValue(summary({ trial: { available: false, used: true } }));
    expect(await createInterviewAction({ resumeId: RESUME_ID })).toEqual({
      ok: false,
      code: "INTERVIEW_QUOTA_EXCEEDED",
      meta: { plan: "FREE" },
    });
    expect(createInterview).toHaveBeenCalledTimes(1);
  });

  it("creates for a Pro account with interviews left, and refuses with the reset date at zero", async () => {
    vi.mocked(usageSummary).mockResolvedValue(summary({ plan: "PRO", interviews: { used: 3, limit: 4, left: 1 }, trial: { available: false, used: false } }));
    expect((await createInterviewAction({ resumeId: RESUME_ID })).ok).toBe(true);

    vi.mocked(usageSummary).mockResolvedValue(summary({ plan: "PRO", interviews: { used: 4, limit: 4, left: 0 }, trial: { available: false, used: false } }));
    expect(await createInterviewAction({ resumeId: RESUME_ID })).toEqual({
      ok: false,
      code: "INTERVIEW_QUOTA_EXCEEDED",
      meta: { plan: "PRO", resetsAt: "2026-11-01T00:00:00.000Z" },
    });
  });

  it("creates for a Pro account at zero with pack credits, and not for a Free account holding frozen credits", async () => {
    vi.mocked(usageSummary).mockResolvedValue(
      summary({ plan: "PRO", interviews: { used: 4, limit: 4, left: 0 }, credits: { balance: 2, usable: true }, trial: { available: false, used: false } }),
    );
    expect((await createInterviewAction({ resumeId: RESUME_ID })).ok).toBe(true);

    vi.mocked(usageSummary).mockResolvedValue(summary({ credits: { balance: 2, usable: false }, trial: { available: false, used: true } }));
    expect(await createInterviewAction({ resumeId: RESUME_ID })).toEqual({ ok: false, code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });
  });
});
