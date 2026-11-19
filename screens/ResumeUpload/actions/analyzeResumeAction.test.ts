import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyGuardReport } from "@/lib/ai/analysisGuardrails";
import { analyzeResume } from "@/lib/ai/resumeAnalysis";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { createResume, fetchResumeKey } from "@/lib/database/resume";
import { refundUsage, reserveAnalysis } from "@/lib/database/usage";
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
import { analysisIdFor } from "@/screens/ResumeUpload/utils/analysisId";
import { ACTION_BUDGET_MS, FILE_MS, MODEL_CALL_MS, SAVE_RESERVE_MS } from "@/screens/ResumeUpload/utils/budget";
import { analyzeResumeAction } from "./analyzeResumeAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/database/user", () => ({ ensureUser: vi.fn(async () => "user_1") }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/database/usage", () => ({ reserveAnalysis: vi.fn(), refundUsage: vi.fn(async () => true) }));
vi.mock("@/lib/supabase/server", () => ({ downloadObject: vi.fn(), removeObject: vi.fn(async () => true) }));
vi.mock("@/lib/pdfParse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdfParse")>();
  return { ...actual, extractPdfText: vi.fn() };
});
vi.mock("@/lib/ai/resumeAnalysis", () => ({ analyzeResume: vi.fn() }));
vi.mock("@/lib/database/resume", () => ({ createResume: vi.fn(async () => ({ kind: "saved", id: "resume_1" })), fetchResumeKey: vi.fn(async () => null) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/ai/contentTranslation", () => ({ translateAnalysis: vi.fn(async () => "ready") }));

const OWN_KEY = "cv/user_1/11111111-2222-4333-8444-555555555555.pdf";
const OTHER_OWN_KEY = "cv/user_1/22222222-2222-4333-8444-555555555555.pdf";
const FOREIGN_KEY = "cv/user_2/11111111-2222-4333-8444-555555555555.pdf";
const SUBMISSION = "9f0c4a52-6c1e-4e7a-9d3b-2a5f8e1c7b40";
const OTHER_SUBMISSION = "0b7e2d14-3f9a-4c61-8e05-7d2c9a4b1f63";
/** The analysis the default submission names for user_1. */
const SUBMITTED_ID = analysisIdFor("user_1", SUBMISSION);

const input = (resumeKey = OWN_KEY, submissionKey = SUBMISSION) => ({
  companyName: "Northwind",
  jobTitle: "Frontend Engineer",
  jobDescription: "Build the checkout in React.",
  resumeKey,
  submissionKey,
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
  vi.mocked(reserveAnalysis).mockResolvedValue({ kind: "reserved", eventId: "evt_1" });
  vi.mocked(fetchResumeKey).mockResolvedValue(null);
  vi.mocked(refundUsage).mockResolvedValue(true);
  vi.mocked(createResume).mockImplementation(async (data) => ({ kind: "saved", id: data.id }));
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
  it("rate-limits, reserves the unit against the analysis id the submission names before the download, and stores the row under that id", async () => {
    const result = await analyzeResumeAction(input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "analysis");
    expect(result.data.resumeId).toBe(SUBMITTED_ID);
    expect(fetchResumeKey).toHaveBeenCalledWith(SUBMITTED_ID);
    expect(reserveAnalysis).toHaveBeenCalledWith("user_1", SUBMITTED_ID, 110_000);
    expect(vi.mocked(reserveAnalysis).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(downloadObject).mock.invocationCallOrder[0]);
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
    expect(reserveAnalysis).not.toHaveBeenCalled();
    expect(downloadObject).not.toHaveBeenCalled();
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("refuses at the quota with the reset date, before any download, and removes the upload", async () => {
    vi.mocked(reserveAnalysis).mockRejectedValue(quotaRefusal());

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
    vi.mocked(reserveAnalysis).mockResolvedValueOnce({ kind: "reserved", eventId: "evt_1" }).mockRejectedValueOnce(quotaRefusal());

    const [winner, loser] = await Promise.all([
      analyzeResumeAction(input(OWN_KEY)),
      analyzeResumeAction(input(OTHER_OWN_KEY, OTHER_SUBMISSION)),
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
    expect(reserveAnalysis).not.toHaveBeenCalled();
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
  });

  it("removes the upload when the rest of the form is invalid, and nothing when no key was named", async () => {
    expect(await analyzeResumeAction({ ...input(), jobDescription: "" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
    expect(reserveAnalysis).not.toHaveBeenCalled();

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

    expect(reserveAnalysis).toHaveBeenCalledTimes(4);
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

describe("analyzeResumeAction: the unit is spent only with its row", () => {
  it("hands the unit to the insert after the model: the settle and the row are one transaction (createResume)", async () => {
    expect((await analyzeResumeAction(input())).ok).toBe(true);

    expect(createResume).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: SUBMITTED_ID, usageEventId: "evt_1" }));
    expect(vi.mocked(analyzeResume).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createResume).mock.invocationCallOrder[0]);
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("a unit given back meanwhile (a retry of the submission, the sweep) saves nothing: ANALYSIS_IN_PROGRESS, its upload removed, no refund twice", async () => {
    vi.mocked(createResume).mockResolvedValueOnce({ kind: "unit-released" });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "ANALYSIS_IN_PROGRESS" });
    expect(removeObject).toHaveBeenCalledExactlyOnceWith(OWN_KEY);
    // Whoever gave it back refunded it: this request does not, and takes no second unit.
    expect(refundUsage).not.toHaveBeenCalled();
    expect(reserveAnalysis).toHaveBeenCalledTimes(1);
  });

  it("a unit given back to a retry that already saved the analysis answers with that analysis, this upload removed", async () => {
    vi.mocked(fetchResumeKey).mockResolvedValueOnce(null).mockResolvedValue(OTHER_OWN_KEY);
    vi.mocked(createResume).mockResolvedValueOnce({ kind: "unit-released" });
    vi.mocked(getLocale).mockResolvedValue("es");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await analyzeResumeAction(input(OWN_KEY))).toEqual({ ok: true, data: { resumeId: SUBMITTED_ID } });
    expect(removeObject).toHaveBeenCalledExactlyOnceWith(OWN_KEY);
    expect(refundUsage).not.toHaveBeenCalled();
    expect(translateAnalysis).not.toHaveBeenCalled();
  });

  it("an insert that fails rolled its settle back: the unit is still held and goes back", async () => {
    vi.mocked(createResume).mockRejectedValueOnce(new Error("connection reset"));

    expect(await analyzeResumeAction(input())).toMatchObject({ ok: false, code: "UNKNOWN" });
    expect(refundUsage).toHaveBeenCalledExactlyOnceWith("evt_1", "UNKNOWN");
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
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

/** Drives the fake clock until the action settles: the waits between polls are real timers. */
async function settleWithClock<T>(promise: Promise<T>, maxMs = 60_000): Promise<T> {
  let settled = false;
  let value: T | undefined;
  void promise.then((result) => {
    settled = true;
    value = result;
  });
  for (let elapsed = 0; !settled && elapsed <= maxMs; elapsed += 500) await vi.advanceTimersByTimeAsync(500);
  if (!settled) throw new Error("the action never settled");
  return value as T;
}

describe("analyzeResumeAction: a retry of the same submission", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the same analysis for the same user and key, and another one for another key or user", () => {
    expect(analysisIdFor("user_1", SUBMISSION)).toBe(SUBMITTED_ID);
    expect(SUBMITTED_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(analysisIdFor("user_1", OTHER_SUBMISSION)).not.toBe(SUBMITTED_ID);
    expect(analysisIdFor("user_2", SUBMISSION)).not.toBe(SUBMITTED_ID);
  });

  it("whose first request saved the analysis gets that analysis: no unit, no model, and its own upload removed", async () => {
    // The first request's object is the one the saved row points at.
    vi.mocked(fetchResumeKey).mockResolvedValue(OTHER_OWN_KEY);

    expect(await analyzeResumeAction(input(OWN_KEY))).toEqual({ ok: true, data: { resumeId: SUBMITTED_ID } });
    expect(reserveAnalysis).not.toHaveBeenCalled();
    expect(downloadObject).not.toHaveBeenCalled();
    expect(analyzeResume).not.toHaveBeenCalled();
    expect(createResume).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
    expect(removeObject).toHaveBeenCalledExactlyOnceWith(OWN_KEY);
  });

  it("never removes the object the saved analysis points at, even when the retry names it again", async () => {
    vi.mocked(fetchResumeKey).mockResolvedValue(OWN_KEY);

    expect(await analyzeResumeAction(input(OWN_KEY))).toEqual({ ok: true, data: { resumeId: SUBMITTED_ID } });
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("arriving while the first request still holds its unit, waits for that request's row instead of paying for another", async () => {
    vi.useFakeTimers();
    vi.mocked(reserveAnalysis).mockResolvedValue({ kind: "in-flight" });
    vi.mocked(fetchResumeKey).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(OTHER_OWN_KEY);

    expect(await settleWithClock(analyzeResumeAction(input(OWN_KEY)))).toEqual({ ok: true, data: { resumeId: SUBMITTED_ID } });
    expect(reserveAnalysis).toHaveBeenCalledTimes(2);
    expect(analyzeResume).not.toHaveBeenCalled();
    expect(createResume).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
    expect(removeObject).toHaveBeenCalledExactlyOnceWith(OWN_KEY);
  });

  it("runs the analysis itself when the first request failed while it waited (its unit given back)", async () => {
    vi.useFakeTimers();
    vi.mocked(reserveAnalysis).mockResolvedValueOnce({ kind: "in-flight" }).mockResolvedValueOnce({ kind: "reserved", eventId: "evt_2" });

    expect(await settleWithClock(analyzeResumeAction(input(OWN_KEY)))).toEqual({ ok: true, data: { resumeId: SUBMITTED_ID } });
    expect(analyzeResume).toHaveBeenCalledTimes(1);
    expect(createResume).toHaveBeenCalledWith(expect.objectContaining({ id: SUBMITTED_ID, resumeKey: OWN_KEY }));
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("hands the model the request's deadline less the save's reserve", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    const start = Date.now();

    expect((await analyzeResumeAction(input())).ok).toBe(true);
    expect(vi.mocked(analyzeResume).mock.calls[0][0].deadline).toBe(start + ACTION_BUDGET_MS - SAVE_RESERVE_MS);
  });

  it("a retry that waited the longest for a first request that then failed still leaves its file and a whole analysis call before the deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    const start = Date.now();
    // In flight until the wait is nearly over, then the first request's unit is back and this one takes its own.
    vi.mocked(reserveAnalysis).mockImplementation(async () => (Date.now() - start < 39_000 ? { kind: "in-flight" } : { kind: "reserved", eventId: "evt_2" }));
    let calledAt = 0;
    vi.mocked(analyzeResume).mockImplementationOnce(async () => {
      calledAt = Date.now();
      return { feedback: {} as never, resumeText: { chars: 10, charsSent: 10, truncated: false }, guard: { violations: [], interventions: [], counts: emptyGuardReport().counts } };
    });

    expect(await settleWithClock(analyzeResumeAction(input(OWN_KEY)))).toEqual({ ok: true, data: { resumeId: SUBMITTED_ID } });
    const { deadline } = vi.mocked(analyzeResume).mock.calls[0][0];
    expect(calledAt - start).toBeGreaterThanOrEqual(39_000);
    // The file had its reserve and the analysis call still has its full timeout; the optional calls take what is left.
    expect(deadline).toBe(start + ACTION_BUDGET_MS - SAVE_RESERVE_MS);
    expect((deadline ?? 0) - calledAt).toBeGreaterThanOrEqual(FILE_MS + MODEL_CALL_MS);
  });

  it("says ANALYSIS_IN_PROGRESS when the first request outlasts the wait: nothing taken, nothing analyzed, its own upload removed", async () => {
    vi.useFakeTimers();
    vi.mocked(reserveAnalysis).mockResolvedValue({ kind: "in-flight" });

    expect(await settleWithClock(analyzeResumeAction(input(OWN_KEY)))).toEqual({ ok: false, code: "ANALYSIS_IN_PROGRESS" });
    expect(analyzeResume).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
    expect(removeObject).toHaveBeenCalledExactlyOnceWith(OWN_KEY);
    // A bounded wait, one poll every 1.5 s for 40 s.
    expect(vi.mocked(reserveAnalysis).mock.calls.length).toBeLessThanOrEqual(28);
  });

  it("losing the insert to another request of the submission answers with the winner's analysis, its own unit refunded and upload removed", async () => {
    // Free of the lookup before the insert, taken by the time the insert fails on the primary key.
    vi.mocked(fetchResumeKey).mockResolvedValueOnce(null).mockResolvedValue(OTHER_OWN_KEY);
    vi.mocked(createResume).mockRejectedValueOnce(new Error("Unique constraint failed on the fields: (`id`)"));
    vi.mocked(getLocale).mockResolvedValue("es");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await analyzeResumeAction(input(OWN_KEY))).toEqual({ ok: true, data: { resumeId: SUBMITTED_ID } });
    expect(refundUsage).toHaveBeenCalledExactlyOnceWith("evt_1", "DUPLICATE_SUBMISSION");
    expect(removeObject).toHaveBeenCalledExactlyOnceWith(OWN_KEY);
    // The winner translates its own analysis.
    expect(translateAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a submission key that is not a UUID as invalid input, before any unit", async () => {
    expect(await analyzeResumeAction(input(OWN_KEY, "not-a-uuid"))).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(reserveAnalysis).not.toHaveBeenCalled();
    expect(fetchResumeKey).not.toHaveBeenCalled();
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
  });
});
