import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeResume } from "@/lib/ai/resumeAnalysis";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { createResume } from "@/lib/database/resume";
import { refundUsage, reserveUsage } from "@/lib/database/usage";
import {
  AiRateLimitedError,
  AiUnavailableError,
  AnalysisQuotaExceededError,
  PdfNoTextError,
  PdfUnreadableError,
  RateLimitedError,
} from "@/lib/error/errors";
import { extractTextFromPDFBytes } from "@/lib/pdfParse";
import { ANALYSIS_CONSUMING_FAILURE_CODES } from "@/lib/plans";
import { downloadObject, removeObject } from "@/lib/supabase/server";
import { MAX_RESUME_BYTES } from "@/lib/uploadLimits";
import { analyzeResumeAction } from "./analyzeResumeAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/database/user", () => ({ ensureUser: vi.fn(async () => "user_1") }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/database/usage", () => ({ reserveUsage: vi.fn(), refundUsage: vi.fn(async () => true) }));
vi.mock("@/lib/supabase/server", () => ({ downloadObject: vi.fn(), removeObject: vi.fn(async () => true) }));
vi.mock("@/lib/pdfParse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdfParse")>();
  return { ...actual, extractTextFromPDFBytes: vi.fn() };
});
vi.mock("@/lib/ai/resumeAnalysis", () => ({ analyzeResume: vi.fn() }));
vi.mock("@/lib/database/resume", () => ({ createResume: vi.fn(async () => "resume_1") }));

const OWN_KEY = "cv/user_1/11111111-2222-4333-8444-555555555555.pdf";
const FOREIGN_KEY = "cv/user_2/11111111-2222-4333-8444-555555555555.pdf";

const input = (resumeKey = OWN_KEY) => ({
  companyName: "Northwind",
  jobTitle: "Frontend Engineer",
  jobDescription: "Build the checkout in React.",
  resumeKey,
});

/** `size` bytes that begin as a PDF does. */
function pdfBytes(size = 2048): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  return bytes;
}

beforeEach(() => {
  // clearAllMocks drops call history, not implementations set by a test.
  vi.clearAllMocks();
  vi.mocked(assertRateLimit).mockResolvedValue(undefined);
  vi.mocked(reserveUsage).mockResolvedValue({ eventId: "evt_1" });
  vi.mocked(refundUsage).mockResolvedValue(true);
  vi.mocked(createResume).mockImplementation(async (data) => data.id);
  vi.mocked(downloadObject).mockResolvedValue(pdfBytes());
  vi.mocked(extractTextFromPDFBytes).mockResolvedValue("Jane Doe. Frontend engineer.");
  vi.mocked(analyzeResume).mockResolvedValue({
    feedback: {} as never,
    resumeText: { chars: 10, charsSent: 10, truncated: false },
    guard: {
      violations: [{ check: "evidence-grounding", path: "skills.matchedSkills[0].evidence", value: "x" }] as never,
      interventions: [{ check: "evidence-grounding", action: "quote-dropped", path: "skills.matchedSkills[0].evidence", value: "x" }],
      counts: { "quote-dropped": 1, "quote-normalized": 0, "number-placeheld": 0, "bullet-dropped": 0, recorded: 0 },
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("analyzeResumeAction: the key and the unit", () => {
  it("rate-limits, reserves the unit against a minted analysis id before the download, and stores the row under that id", async () => {
    const result = await analyzeResumeAction(input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "analysis");
    expect(reserveUsage).toHaveBeenCalledWith("user_1", "ANALYSIS", result.data.resumeId);
    expect(vi.mocked(reserveUsage).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(downloadObject).mock.invocationCallOrder[0]);
    expect(createResume).toHaveBeenCalledWith(expect.objectContaining({ id: result.data.resumeId, resumeKey: OWN_KEY }));
    // The guardrail's counts and edits are stored with the row; the violations list is not.
    const stored = vi.mocked(createResume).mock.calls[0][0].guardStats;
    expect(stored.counts["quote-dropped"]).toBe(1);
    expect(stored.interventions).toHaveLength(1);
    expect(stored).not.toHaveProperty("violations");
    expect(refundUsage).not.toHaveBeenCalled();
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("treats another user's key as not found: no reservation, no download, nothing deleted", async () => {
    expect(await analyzeResumeAction(input(FOREIGN_KEY))).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(reserveUsage).not.toHaveBeenCalled();
    expect(downloadObject).not.toHaveBeenCalled();
  });

  it("refuses at the quota with the reset date, before any download", async () => {
    vi.mocked(reserveUsage).mockRejectedValue(new AnalysisQuotaExceededError({ plan: "FREE", resetsAt: "2026-11-01T00:00:00.000Z" }));

    expect(await analyzeResumeAction(input())).toEqual({
      ok: false,
      code: "ANALYSIS_QUOTA_EXCEEDED",
      meta: { plan: "FREE", resetsAt: "2026-11-01T00:00:00.000Z" },
    });
    expect(downloadObject).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("answers RATE_LIMITED before the quota", async () => {
    vi.mocked(assertRateLimit).mockRejectedValue(new RateLimitedError(30));

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "RATE_LIMITED", meta: { retryAfter: 30 } });
    expect(reserveUsage).not.toHaveBeenCalled();
  });
});

describe("analyzeResumeAction: what is refunded", () => {
  it("names the user's-file codes that keep the unit spent", () => {
    expect([...ANALYSIS_CONSUMING_FAILURE_CODES].sort()).toEqual(["FILE_TOO_LARGE", "NOT_A_PDF", "PDF_NO_TEXT", "PDF_UNREADABLE"]);
  });

  it("keeps the unit for a file that is not a PDF, has no text, is unreadable or is too large, and deletes the object", async () => {
    vi.mocked(downloadObject).mockResolvedValueOnce(new TextEncoder().encode("PK\u0003\u0004 a docx renamed"));
    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "NOT_A_PDF" });

    vi.mocked(extractTextFromPDFBytes).mockRejectedValueOnce(new PdfNoTextError());
    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "PDF_NO_TEXT" });

    vi.mocked(extractTextFromPDFBytes).mockRejectedValueOnce(new PdfUnreadableError());
    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "PDF_UNREADABLE" });

    vi.mocked(downloadObject).mockResolvedValueOnce(pdfBytes(MAX_RESUME_BYTES + 1));
    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "FILE_TOO_LARGE" });

    expect(reserveUsage).toHaveBeenCalledTimes(4);
    expect(refundUsage).not.toHaveBeenCalled();
    expect(removeObject).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["the model is down", () => vi.mocked(analyzeResume).mockRejectedValueOnce(new AiUnavailableError()), "AI_UNAVAILABLE"],
    ["the model is rate-limited", () => vi.mocked(analyzeResume).mockRejectedValueOnce(new AiRateLimitedError()), "AI_RATE_LIMITED"],
    ["the object never arrived", () => vi.mocked(downloadObject).mockResolvedValueOnce(null), "UPLOAD_FAILED"],
    ["the row cannot be written", () => vi.mocked(createResume).mockRejectedValueOnce(new Error("connection reset")), "UNKNOWN"],
  ])("refunds the unit with the code when %s", async (_, arrange, code) => {
    arrange();

    expect(await analyzeResumeAction(input())).toMatchObject({ ok: false, code });
    expect(refundUsage).toHaveBeenCalledWith("evt_1", code);
  });

  it("still returns the failure when the refund itself fails", async () => {
    vi.mocked(analyzeResume).mockRejectedValueOnce(new AiUnavailableError());
    vi.mocked(refundUsage).mockRejectedValueOnce(new Error("db down"));

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "AI_UNAVAILABLE" });
  });
});

describe("analyzeResumeAction: after the download", () => {
  it("deletes the object when the model fails, so no file outlives a flow with no row", async () => {
    vi.mocked(analyzeResume).mockRejectedValue(new AiUnavailableError());

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "AI_UNAVAILABLE" });
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
    expect(createResume).not.toHaveBeenCalled();
  });

  it("keeps the object once the row points at it", async () => {
    await analyzeResumeAction(input());
    expect(removeObject).not.toHaveBeenCalled();
  });
});
