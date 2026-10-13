import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeResume } from "@/lib/ai/resumeAnalysis";
import { createResume } from "@/lib/database/resume";
import { AiUnavailableError, PdfNoTextError } from "@/lib/error/errors";
import { extractTextFromPDFBytes } from "@/lib/pdfParse";
import { downloadObject, removeObject } from "@/lib/supabase/server";
import { MAX_RESUME_BYTES } from "@/lib/uploadLimits";
import { analyzeResumeAction } from "./analyzeResumeAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("@/lib/supabase/server", () => ({ downloadObject: vi.fn(), removeObject: vi.fn(async () => {}) }));
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
  vi.mocked(createResume).mockResolvedValue("resume_1");
  vi.mocked(downloadObject).mockResolvedValue(pdfBytes());
  vi.mocked(extractTextFromPDFBytes).mockResolvedValue("Jane Doe. Frontend engineer.");
  vi.mocked(analyzeResume).mockResolvedValue({
    feedback: {} as never,
    resumeText: { chars: 10, charsSent: 10, truncated: false },
    guard: {} as never,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("analyzeResumeAction: the key", () => {
  it("downloads the caller's own object, analyzes it and stores the key", async () => {
    const result = await analyzeResumeAction(input());

    expect(result).toEqual({ ok: true, data: { resumeId: "resume_1" } });
    expect(downloadObject).toHaveBeenCalledWith(OWN_KEY);
    expect(createResume).toHaveBeenCalledWith(expect.objectContaining({ resumeKey: OWN_KEY }));
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("treats another user's key as not found: no download, and nothing deleted", async () => {
    expect(await analyzeResumeAction(input(FOREIGN_KEY))).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(downloadObject).not.toHaveBeenCalled();
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("rejects a key of the wrong shape before the session is even consulted for ownership", async () => {
    expect(await analyzeResumeAction(input("cv/user_1/resume.pdf"))).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await analyzeResumeAction(input("https://x.supabase.co/storage/v1/object/public/files-bucket/cv/user_1/x.pdf"))).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(downloadObject).not.toHaveBeenCalled();
  });

  it("answers UPLOAD_FAILED when no object sits under the key, with nothing to delete", async () => {
    vi.mocked(downloadObject).mockResolvedValue(null);

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "UPLOAD_FAILED" });
    expect(removeObject).not.toHaveBeenCalled();
    expect(extractTextFromPDFBytes).not.toHaveBeenCalled();
  });
});

describe("analyzeResumeAction: the bytes", () => {
  it("rejects bytes that are not a PDF with NOT_A_PDF, deletes the object, and never parses", async () => {
    vi.mocked(downloadObject).mockResolvedValue(new TextEncoder().encode("PK\u0003\u0004 a docx renamed"));

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "NOT_A_PDF" });
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
    expect(extractTextFromPDFBytes).not.toHaveBeenCalled();
    expect(analyzeResume).not.toHaveBeenCalled();
  });

  it("rejects an object over the limit with FILE_TOO_LARGE and deletes it, and accepts one at the limit", async () => {
    vi.mocked(downloadObject).mockResolvedValue(pdfBytes(MAX_RESUME_BYTES + 1));
    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
    expect(analyzeResume).not.toHaveBeenCalled();

    vi.clearAllMocks();
    vi.mocked(downloadObject).mockResolvedValue(pdfBytes(MAX_RESUME_BYTES));
    vi.mocked(extractTextFromPDFBytes).mockResolvedValue("Jane Doe.");
    vi.mocked(analyzeResume).mockResolvedValue({ feedback: {} as never, resumeText: { chars: 9, charsSent: 9, truncated: false }, guard: {} as never });
    expect((await analyzeResumeAction(input())).ok).toBe(true);
  });

  it("passes the parser's own codes through and deletes the object", async () => {
    vi.mocked(extractTextFromPDFBytes).mockRejectedValue(new PdfNoTextError());

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "PDF_NO_TEXT" });
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

  it("deletes the object when the row cannot be written", async () => {
    vi.mocked(createResume).mockRejectedValue(new Error("connection reset"));

    expect(await analyzeResumeAction(input())).toEqual({ ok: false, code: "UNKNOWN" });
    expect(removeObject).toHaveBeenCalledWith(OWN_KEY);
  });

  it("keeps the object once the row points at it", async () => {
    await analyzeResumeAction(input());
    expect(removeObject).not.toHaveBeenCalled();
  });
});
