import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractTechstackFromDescription } from "@/lib/ai/techstack";
import { createInterview } from "@/lib/database/interview";
import { fetchResumeById } from "@/lib/database/resume";
import {
  AiContentBlockedError,
  AiFormatError,
  AiMisconfiguredError,
  AiRateLimitedError,
  AiUnavailableError,
} from "@/lib/error/errors";
import { createInterviewAction } from "./createInterviewAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("@/lib/ai/techstack", () => ({ extractTechstackFromDescription: vi.fn() }));
vi.mock("@/lib/database/resume", () => ({ fetchResumeById: vi.fn() }));
vi.mock("@/lib/database/interview", () => ({ createInterview: vi.fn() }));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

beforeEach(() => {
  // restoreMocks only restores spies; call history on vi.fn() survives it.
  vi.clearAllMocks();
  vi.mocked(fetchResumeById).mockResolvedValue({
    id: RESUME_ID,
    jobTitle: "Frontend Engineer",
    jobDescription: "React, TypeScript, testing.",
    interview: null,
  } as unknown as Awaited<ReturnType<typeof fetchResumeById>>);
  vi.mocked(createInterview).mockResolvedValue("interview_1");
  // The action logs failures server-side; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("createInterviewAction: techstack extraction failures", () => {
  it.each([
    ["AI_UNAVAILABLE", new AiUnavailableError()],
    ["AI_RATE_LIMITED", new AiRateLimitedError()],
    ["AI_CONTENT_BLOCKED", new AiContentBlockedError()],
    ["AI_BAD_FORMAT", new AiFormatError()],
  ])("creates the interview without chips on %s", async (_, error) => {
    vi.mocked(extractTechstackFromDescription).mockRejectedValue(error);

    const result = await createInterviewAction({ resumeId: RESUME_ID });

    expect(result).toEqual({ ok: true, data: { interviewId: "interview_1" } });
    expect(createInterview).toHaveBeenCalledWith(
      expect.objectContaining({ techstack: [] }),
    );
  });

  it("stops on AI_MISCONFIGURED, before creating anything", async () => {
    vi.mocked(extractTechstackFromDescription).mockRejectedValue(
      new AiMisconfiguredError(),
    );

    const result = await createInterviewAction({ resumeId: RESUME_ID });

    expect(result).toEqual({ ok: false, code: "AI_MISCONFIGURED" });
    expect(createInterview).not.toHaveBeenCalled();
  });

  it("stops on a failure that is not the AI's", async () => {
    vi.mocked(extractTechstackFromDescription).mockRejectedValue(
      new Error("socket hang up"),
    );

    const result = await createInterviewAction({ resumeId: RESUME_ID });

    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
    expect(createInterview).not.toHaveBeenCalled();
  });

  it("keeps the extracted chips when extraction works", async () => {
    vi.mocked(extractTechstackFromDescription).mockResolvedValue(["React"]);

    await createInterviewAction({ resumeId: RESUME_ID });

    expect(createInterview).toHaveBeenCalledWith(
      expect.objectContaining({ techstack: ["React"] }),
    );
  });
});
