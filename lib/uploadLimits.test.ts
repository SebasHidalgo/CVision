import { describe, expect, it } from "vitest";
import {
  analyzeResumeInputSchema,
  createResumeInputSchema,
  MAX_COMPANY_NAME_CHARS,
  MAX_JOB_DESCRIPTION_CHARS,
  MAX_JOB_TITLE_CHARS,
} from "@/lib/schemas/resumeSchema";
import { MAX_ACTION_BODY_BYTES, MAX_RESUME_BYTES, MAX_RESUME_SIZE_LABEL } from "./uploadLimits";

const pdf = (bytes: number, name = "cv.pdf") =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

function parseWithResume(resume: File) {
  return createResumeInputSchema.safeParse({
    companyName: "Northwind",
    jobTitle: "Frontend Engineer",
    jobDescription: "Build and ship the checkout flow.",
    resume,
  });
}

describe("resume size limit: the form's schema", () => {
  it("is ten mebibytes, written as 10 MB", () => {
    expect(MAX_RESUME_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_RESUME_SIZE_LABEL).toBe("10 MB");
  });

  it("accepts a PDF of exactly the limit", () => {
    expect(parseWithResume(pdf(MAX_RESUME_BYTES)).success).toBe(true);
  });

  it("rejects a PDF one byte over the limit, naming the limit", () => {
    const result = parseWithResume(pdf(MAX_RESUME_BYTES + 1));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["resume"],
        message: `The file is larger than ${MAX_RESUME_SIZE_LABEL}`,
      }),
    ]);
  });

  it("rejects an empty file", () => {
    expect(parseWithResume(pdf(0)).success).toBe(false);
  });
});

describe("action body limit", () => {
  it("fits the largest analysis request with room to spare, since no action carries a file", () => {
    // Worst case: every text field at its cap in 3-byte UTF-8 characters,
    // plus a key. React serializes the argument as JSON with a small frame.
    const wide = (length: number) => "€".repeat(length);
    const body = JSON.stringify([
      {
        companyName: wide(MAX_COMPANY_NAME_CHARS),
        jobTitle: wide(MAX_JOB_TITLE_CHARS),
        jobDescription: wide(MAX_JOB_DESCRIPTION_CHARS),
        resumeKey: "cv/user_33lmzGC7RVwHdO7fMab9Qd6Ing8/11111111-2222-4333-8444-555555555555.pdf",
      },
    ]);
    const bytes = new TextEncoder().encode(body).byteLength;

    expect(bytes).toBeLessThan(26 * 1024);
    expect(MAX_ACTION_BODY_BYTES).toBeGreaterThanOrEqual(bytes * 10);
    // Well under Next's 1 MB default: the limit only has to admit text now.
    expect(MAX_ACTION_BODY_BYTES).toBeLessThanOrEqual(1024 * 1024);
  });

  it("the action's schema takes a key, never a file", () => {
    const parsed = analyzeResumeInputSchema.safeParse({
      companyName: "Northwind",
      jobTitle: "Frontend Engineer",
      jobDescription: "Build and ship the checkout flow.",
      resumeKey: "cv/user_1/11111111-2222-4333-8444-555555555555.pdf",
    });
    expect(parsed.success).toBe(true);

    expect(
      analyzeResumeInputSchema.safeParse({
        companyName: "Northwind",
        jobTitle: "Frontend Engineer",
        jobDescription: "Build and ship the checkout flow.",
        resumeKey: "https://x.supabase.co/storage/v1/object/public/files-bucket/cv/user_1/x.pdf",
      }).success,
    ).toBe(false);
  });
});
