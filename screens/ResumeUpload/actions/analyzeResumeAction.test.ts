import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyGuardReport } from "@/lib/ai/analysisGuardrails";
import { analyzeResume } from "@/lib/ai/resumeAnalysis";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { createResume } from "@/lib/database/resume";
import { refundUsage, reserveUsage } from "@/lib/database/usage";
import {
  AiBillingError,
  AiRateLimitedError,
  AiUnavailableError,
  AnalysisQuotaExceededError,
  PdfNoTextError,
  PdfUnreadableError,
  RateLimitedError,
} from "@/lib/error/errors";
import { extractPdfText } from "@/lib/pdfParse";
import { downloadObject, removeObject } from "@/lib/supabase/server";
import { MAX_RESUME_BYTES } from "@/lib/uploadLimits";
import { translateAnalysis } from "@/lib/ai/contentTranslation";
import { getLocale } from "@/lib/i18n/server";
import { analyzeResumeAction } from "./analyzeResumeAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/database/user", () => ({ ensureUser: vi.fn(async () => "user_1") }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/database/usage", () => ({ reserveUsage: vi.fn(), refundUsage: vi.fn(async () => true) }));
vi.mock("@/lib/supabase/server", () => ({ downloadObject: vi.fn(), removeObject: vi.fn(async () => true) }));
vi.mock("@/lib/pdfParse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdfParse")>();
  return { ...actual, extractPdfText: vi.fn() };
});
vi.mock("@/lib/ai/resumeAnalysis", () => ({ analyzeResume: vi.fn() }));
vi.mock("@/lib/database/resume", () => ({ createResume: vi.fn(async () => "resume_1") }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/ai/contentTranslation", () => ({ translateAnalysis: vi.fn(async () => "ready") }));

const OWN_KEY = "cv/user_1/11111111-2222-4333-8444-555555555555.pdf";
const OTHER_OWN_KEY = "cv/user_1/22222222-2222-4333-8444-555555555555.pdf";
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

const quotaRefusal = () =>
  new AnalysisQuotaExceededError({ plan: "FREE", resetsAt: "2026-11-01T00:00:00.000Z" });

beforeEach(() => {
  // clearAllMocks drops call history, not implementations set by a test.
  vi.clearAllMocks();
  vi.mocked(assertRateLimit).mockResolvedValue(undefined);
  vi.mocked(reserveUsage).mockResolvedValue({ eventId: "evt_1" });
  vi.mocked(refundUsage).mockResolvedValue(true);
  vi.mocked(createResume).mockImplementation(async (data) => data.id);
  vi.mocked(downloadObject).mockResolvedValue(pdfBytes());
  vi.mocked(extractPdfText).mockResolvedValue({ text: "Jane Doe. Frontend engineer.", accentsComposed: 0 });
  vi.mocked(analyzeResume).mockResolvedValue({
    feedback: {} as never,
    resumeText: { chars: 10, charsSent: 10, truncated: false },
    guard: {
      violations: [{ check: "evidence-grounding", path: "skills.matchedSkills[0].evidence", value: "x" }] as never,
      interventions: [{ check: "evidence-grounding", action: "quote-dropped", path: "skills.matchedSkills[0].evidence", value: "x" }],
      counts: { ...emptyGuardReport().counts, "quote-dropped": 1 },
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getLocale).mockResolvedValue("en");
  vi.mocked(translateAnalysis).mockResolvedValue("ready");
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

  it("treats another user's key as not found: no rate limit taken, no reservation, no download, nothing deleted", async () => {
    expect(await analyzeResumeAction(input(FOREIGN_KEY))).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(assertRateLimit).not.toHaveBeenCalled();
    expect(reserveUsage).not.toHaveBeenCalled();
    expect(downloadObject).not.toHaveBeenCalled();
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("refuses at the quota with the reset date, before any download, and removes the upload", async () => {
    vi.mocked(reserveUsage).mockRejectedValue(quotaRefusal());

    expect(await analyzeResumeAction(input())).toEqual({
      ok: false,
      code: "ANALYSIS_QUOTA_EXCEEDED",
      meta: { plan: "FREE", resetsAt: "2026-11-01T00:00:00.000Z" },
    });
    expect(downloadObject).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
  });

  it("two tabs at the last analysis: the winner keeps its object, the loser's is removed", async () => {
    // Both tabs got an upload URL (the URL action checks the quota without
    // reserving) and both PUT their file; the ledger decides here.
    vi.mocked(reserveUsage).mockResolvedValueOnce({ eventId: "evt_1" }).mockRejectedValueOnce(quotaRefusal());

    const [winner, loser] = await Promise.all([
      analyzeResumeAction(input(OWN_KEY)),
      analyzeResumeAction(input(OTHER_OWN_KEY)),
    ]);

    expect(winner.ok).toBe(true);
    expect(loser).toMatchObject({ ok: false, code: "ANALYSIS_QUOTA_EXCEEDED" });
    expect(removeObject).toHaveBeenCalledTimes(1);
    expect(removeObject).toHaveBeenCalledWith(OTHER_OWN_KEY);
    expect(createResume).toHaveBeenCalledTimes(1);
    expect(createResume).toHaveBeenCalledWith(expect.objectContaining({ resumeKey: OWN_KEY }));
  });

  it("answers RATE_LIMITED before the quota, and removes the caller's own upload", async () => {
    vi.mocked(assertRateLimit).mockRejectedValue(new RateLimitedError(30));

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "RATE_LIMITED", meta: { retryAfter: 30 } });
    expect(reserveUsage).not.toHaveBeenCalled();
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
  });

  it("removes the upload when the rest of the form is invalid, and nothing when no key was named", async () => {
    expect(await analyzeResumeAction({ ...input(), jobDescription: "" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
    expect(reserveUsage).not.toHaveBeenCalled();

    vi.mocked(removeObject).mockClear();
    expect(await analyzeResumeAction({ companyName: "x" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(removeObject).not.toHaveBeenCalled();
  });
});

describe("analyzeResumeAction: every failure refunds", () => {
  it("gives the unit back for a file that is not a PDF, has no text, is unreadable or is too large, and deletes the object", async () => {
    vi.mocked(downloadObject).mockResolvedValueOnce(new TextEncoder().encode("PK\u0003\u0004 a docx renamed"));
    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "NOT_A_PDF" });

    vi.mocked(extractPdfText).mockRejectedValueOnce(new PdfNoTextError());
    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "PDF_NO_TEXT" });

    vi.mocked(extractPdfText).mockRejectedValueOnce(new PdfUnreadableError());
    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "PDF_UNREADABLE" });

    vi.mocked(downloadObject).mockResolvedValueOnce(pdfBytes(MAX_RESUME_BYTES + 1));
    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "FILE_TOO_LARGE" });

    expect(reserveUsage).toHaveBeenCalledTimes(4);
    expect(vi.mocked(refundUsage).mock.calls.map(([, reason]) => reason)).toEqual([
      "NOT_A_PDF",
      "PDF_NO_TEXT",
      "PDF_UNREADABLE",
      "FILE_TOO_LARGE",
    ]);
    expect(removeObject).toHaveBeenCalledTimes(4);
    // None of these reached the model.
    expect(analyzeResume).not.toHaveBeenCalled();
  });

  it("refuses the scanned-cv fixture with PDF_SCANNED through the real parser: unit refunded, object deleted, no model call", async () => {
    const actual = await vi.importActual<typeof import("@/lib/pdfParse")>("@/lib/pdfParse");
    const scan = new Uint8Array(readFileSync(path.join(process.cwd(), "scripts/eval/fixtures/scanned-cv/cv.pdf")));
    vi.mocked(downloadObject).mockResolvedValueOnce(scan);
    vi.mocked(extractPdfText).mockImplementationOnce(actual.extractPdfText);

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "PDF_SCANNED" });
    expect(refundUsage).toHaveBeenCalledWith("evt_1", "PDF_SCANNED");
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
    expect(analyzeResume).not.toHaveBeenCalled();
  });

  it.each([
    ["the model is down", () => vi.mocked(analyzeResume).mockRejectedValueOnce(new AiUnavailableError()), "AI_UNAVAILABLE"],
    ["the model is rate-limited", () => vi.mocked(analyzeResume).mockRejectedValueOnce(new AiRateLimitedError()), "AI_RATE_LIMITED"],
    ["the model account is out of balance", () => vi.mocked(analyzeResume).mockRejectedValueOnce(new AiBillingError()), "AI_BILLING"],
    ["the object never arrived", () => vi.mocked(downloadObject).mockResolvedValueOnce(null), "UPLOAD_FAILED"],
    ["the row cannot be written", () => vi.mocked(createResume).mockRejectedValueOnce(new Error("connection reset")), "UNKNOWN"],
  ])("refunds the unit with the code when %s", async (_, arrange, code) => {
    arrange();

    expect(await analyzeResumeAction(input())).toMatchObject({ ok: false, code });
    expect(refundUsage).toHaveBeenCalledWith("evt_1", code);
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
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

describe("analyzeResumeAction: the interface language", () => {
  it("translates a saved analysis for a Spanish interface, once, after the row exists", async () => {
    vi.mocked(getLocale).mockResolvedValue("es");
    const result = await analyzeResumeAction(input());
    expect(result.ok).toBe(true);
    const resumeId = vi.mocked(createResume).mock.calls[0][0].id;
    expect(translateAnalysis).toHaveBeenCalledWith("user_1", expect.objectContaining({ id: resumeId, companyName: "Northwind", jobTitle: "Frontend Engineer" }), "es", expect.any(Number));
    expect(vi.mocked(createResume).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(translateAnalysis).mock.invocationCallOrder[0]);
  });

  it("never translates English, and a translation problem never fails a saved analysis", async () => {
    await analyzeResumeAction(input());
    expect(translateAnalysis).not.toHaveBeenCalled();

    vi.mocked(getLocale).mockResolvedValue("es");
    vi.mocked(translateAnalysis).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await analyzeResumeAction(input());
    expect(result.ok).toBe(true);
    expect(refundUsage).not.toHaveBeenCalled();
    expect(removeObject).not.toHaveBeenCalled();
  });
});
