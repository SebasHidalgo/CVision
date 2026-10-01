import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractTextFromPDFFile } from "@/lib/pdfParse";
import { analyzeResumeAction } from "@/screens/ResumeUpload/actions/analyzeResumeAction";
import golden from "./analysisRequest.golden.json";
import { installFakeProvider, reply, type ProviderRequest } from "./client.stub";
import { analyzeResume, MAX_RESUME_TEXT_CHARS } from "./resumeAnalysis";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("@/lib/pdfParse", () => ({ extractTextFromPDFFile: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  buildResumeKey: vi.fn(() => "cv/user_1/x.pdf"),
  uploadFileToSupabase: vi.fn(async () => "https://example.test/cv.pdf"),
  removeFileFromSupabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/resume", () => ({
  createResume: vi.fn(async () => "resume_1"),
}));

// The inputs the golden was recorded with. Changing one invalidates it.
const JOB_TITLE = "Frontend Engineer";
const JOB_DESCRIPTION = "Build the checkout in React and TypeScript. Testing matters.";
const SHORT_CV = "Jane Doe. Frontend engineer. React, TypeScript. BSc 2018.";
const LONG_CV = `${"a".repeat(19_990)}<<KEEP>>${"b".repeat(200)}<<CUT>>`;

/** The request the provider received for one call, via the real HTTP boundary. */
async function requestFrom(call: () => Promise<unknown>): Promise<ProviderRequest> {
  // An empty answer fails schema validation, which is irrelevant here: the
  // request is already on the wire by then, and only the request is asserted.
  const provider = installFakeProvider(() => reply.json({}));
  await call().catch(() => {});
  vi.unstubAllGlobals();

  expect(provider.requests).toHaveLength(1);
  return provider.requests[0];
}

function viaHarnessPath(resumeText: string) {
  return requestFrom(() =>
    analyzeResume({ jobTitle: JOB_TITLE, jobDescription: JOB_DESCRIPTION, resumeText }),
  );
}

function viaActionPath(resumeText: string) {
  vi.mocked(extractTextFromPDFFile).mockResolvedValue(resumeText);
  const body = new FormData();
  body.append("companyName", "Northwind");
  body.append("jobTitle", JOB_TITLE);
  body.append("jobDescription", JOB_DESCRIPTION);
  body.append(
    "resume",
    new File([new Uint8Array(1024)], "cv.pdf", { type: "application/pdf" }),
  );

  return requestFrom(() => analyzeResumeAction(body));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

/*
 * analysisRequest.golden.json was recorded from analyzeResumeAction at commit
 * e7b98d6, before the model step moved into analyzeResume. Both call sites must
 * still put exactly those bytes on the wire.
 */
describe.each([
  ["typical", SHORT_CV, golden.typical],
  ["overlong", LONG_CV, golden.overlong],
])("the request for a %s CV is unchanged by the refactor", (_, cv, expected) => {
  it("from the Server Action", async () => {
    expect(await viaActionPath(cv)).toEqual(expected);
  });

  it("from analyzeResume, which the harness calls", async () => {
    expect(await viaHarnessPath(cv)).toEqual(expected);
  });
});

describe("truncation", () => {
  it("cuts the CV at the limit and keeps everything before it", async () => {
    const request = await viaHarnessPath(LONG_CV);

    expect(request.prompt).toContain("<<KEEP>>");
    expect(request.prompt).not.toContain("<<CUT>>");
  });

  it("sends a short CV whole", async () => {
    const request = await viaHarnessPath(SHORT_CV);

    expect(request.prompt).toContain(SHORT_CV);
    expect(SHORT_CV.length).toBeLessThan(MAX_RESUME_TEXT_CHARS);
  });
});
