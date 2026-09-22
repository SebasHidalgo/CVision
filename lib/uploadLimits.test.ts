import { describe, expect, it } from "vitest";
import {
  createResumeInputSchema,
  MAX_COMPANY_NAME_CHARS,
  MAX_JOB_DESCRIPTION_CHARS,
  MAX_JOB_TITLE_CHARS,
} from "@/lib/schemas/resumeSchema";
import {
  MAX_ACTION_BODY_BYTES,
  MAX_RESUME_BYTES,
  MAX_RESUME_SIZE_LABEL,
  PLATFORM_MAX_BODY_BYTES,
} from "./uploadLimits";

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

describe("resume size limit: schema", () => {
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

describe("resume size limit: request body", () => {
  it("keeps the Server Action body limit under Vercel's 4.5 MB cap", () => {
    expect(MAX_ACTION_BODY_BYTES).toBeLessThanOrEqual(PLATFORM_MAX_BODY_BYTES);
  });

  it("fits the largest request the upload form can send", async () => {
    // Worst case: every text field at its cap in 3-byte UTF-8 characters, a
    // long file name, and the file at the limit. Framed the way React sends a
    // FormData argument: a root reference plus entries prefixed with its id.
    const wide = (length: number) => "€".repeat(length);
    const body = new FormData();
    body.append("0", '"$K1"');
    body.append("1_companyName", wide(MAX_COMPANY_NAME_CHARS));
    body.append("1_jobTitle", wide(MAX_JOB_TITLE_CHARS));
    body.append("1_jobDescription", wide(MAX_JOB_DESCRIPTION_CHARS));
    body.append("1_resume", pdf(MAX_RESUME_BYTES, `${wide(250)}.pdf`));

    const encoded = await new Response(body).arrayBuffer();

    expect(encoded.byteLength).toBeGreaterThan(MAX_RESUME_BYTES);
    expect(encoded.byteLength).toBeLessThanOrEqual(MAX_ACTION_BODY_BYTES);
  });
});
