import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInterview } from "@/lib/database/interview";
import { fetchResumeById } from "@/lib/database/resume";
import { MAX_TECHSTACK_ITEM_CHARS, MAX_TECHSTACK_ITEMS } from "@/lib/schemas/interviewSchema";
import type { ResumeAnalysis } from "@/types/resume";
import { createInterviewAction } from "./createInterviewAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
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
    resumeUrl: "cv/user_1/x.pdf",
    userId: "user_1",
    createdAt: "2026-10-01T00:00:00.000Z",
    interview: null,
    feedback: {
      skills: { matchedSkills },
    } as unknown as ResumeAnalysis["feedback"],
    ...overrides,
  };
}

beforeEach(() => {
  // restoreMocks only restores spies; call history on vi.fn() survives it.
  vi.clearAllMocks();
  vi.mocked(createInterview).mockResolvedValue("interview_1");
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
  it("returns the existing interview instead of creating a second one", async () => {
    vi.mocked(fetchResumeById).mockResolvedValue(
      resumeWith([], {
        interview: { id: "interview_0", status: "SCHEDULED", finalized: false },
      }),
    );

    const result = await createInterviewAction({ resumeId: RESUME_ID });

    expect(result).toEqual({ ok: true, data: { interviewId: "interview_0" } });
    expect(createInterview).not.toHaveBeenCalled();
  });

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
});
