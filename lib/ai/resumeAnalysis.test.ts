import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractTextFromPDFFile } from "@/lib/pdfParse";
import { analyzeResumeAction } from "@/screens/ResumeUpload/actions/analyzeResumeAction";
import golden from "./analysisRequest.golden.json";
import { installFakeProvider, reply, type ProviderRequest } from "./client.stub";
import {
  analyzeResume,
  MAX_RESUME_TEXT_CHARS,
  truncateResumeText,
} from "./resumeAnalysis";

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

// Exactly at the limit, with a marker on its last characters, and one char over.
const AT_LIMIT = `${"a".repeat(MAX_RESUME_TEXT_CHARS - 7)}<<END>>`;
const OVER_LIMIT = `${AT_LIMIT}<<CUT>>`;

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

/** The smallest answer that satisfies resumeFeedbackSchema. */
const SECTION = { score: 70, description: "" };
const VALID_FEEDBACK = {
  overall: { globalScore: 70, verdict: "Good", summaryText: "", prioritizedFixes: [] },
  atsCompatibility: { ...SECTION, problems: [], fixes: [], evidence: [] },
  experienceAndImpact: {
    ...SECTION,
    strengths: [],
    weaknesses: [],
    suggestedBullets: [],
  },
  skills: { ...SECTION, matchedSkills: [], missingSkills: [], actionPlan: [] },
  educationAndCertifications: {
    ...SECTION,
    highlights: [],
    improvements: [],
    recommendedCerts: [],
  },
  toneAndClarity: { ...SECTION, readability: 60, suggestions: [] },
  jobFit: {
    ...SECTION,
    matchedKeywords: [],
    missingKeywords: [],
    strategicRecommendations: [],
  },
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

/*
 * analysisRequest.golden.json was recorded from analyzeResumeAction at commit
 * e7b98d6, before the model step moved into analyzeResume. Both call sites must
 * still put exactly those bytes on the wire.
 *
 * It held a second case, a CV over the old 20,000-char limit. M2c-B raised
 * that limit deliberately, so those bytes are no longer the right answer and
 * the entry is gone; the boundary is pinned by the tests below instead. The
 * original proof stays in the history at commit 7543dd1.
 */
describe("the request for a typical CV is unchanged by the refactor", () => {
  it("from the Server Action", async () => {
    expect(await viaActionPath(SHORT_CV)).toEqual(golden.typical);
  });

  it("from analyzeResume, which the harness calls", async () => {
    expect(await viaHarnessPath(SHORT_CV)).toEqual(golden.typical);
  });
});

describe("truncation at the limit", () => {
  it("passes text of exactly the limit through whole", () => {
    const sent = truncateResumeText(AT_LIMIT);

    expect(sent).toMatchObject({
      chars: MAX_RESUME_TEXT_CHARS,
      charsSent: MAX_RESUME_TEXT_CHARS,
      truncated: false,
    });
    expect(sent.text).toBe(AT_LIMIT);
  });

  it("cuts text one character over, and says so", () => {
    const sent = truncateResumeText(OVER_LIMIT);

    expect(sent).toMatchObject({
      chars: MAX_RESUME_TEXT_CHARS + 7,
      charsSent: MAX_RESUME_TEXT_CHARS,
      truncated: true,
    });
    expect(sent.text.endsWith("<<END>>")).toBe(true);
    expect(sent.text).not.toContain("<<CUT>>");
  });

  it("sends the cut text to the model and reports the cut to its caller", async () => {
    const provider = installFakeProvider(() => reply.json({}));

    await analyzeResume({
      jobTitle: JOB_TITLE,
      jobDescription: JOB_DESCRIPTION,
      resumeText: OVER_LIMIT,
    }).catch(() => {});

    expect(provider.requests[0].prompt).toContain("<<END>>");
    expect(provider.requests[0].prompt).not.toContain("<<CUT>>");
    // Truncation must leave a trace: lengths in the log, never CV content.
    expect(warn).toHaveBeenCalledWith(
      `[CVision][ai] resume text truncated: ${MAX_RESUME_TEXT_CHARS + 7} -> ${MAX_RESUME_TEXT_CHARS} chars`,
    );
  });

  it("says nothing when the CV fits", async () => {
    const provider = installFakeProvider(() => reply.json({}));

    const result = await analyzeResume({
      jobTitle: JOB_TITLE,
      jobDescription: JOB_DESCRIPTION,
      resumeText: SHORT_CV,
    }).catch(() => undefined);

    expect(provider.requests[0].prompt).toContain(SHORT_CV);
    expect(warn).not.toHaveBeenCalled();
    expect(result).toBeUndefined(); // the stub's empty answer fails the schema
  });

  it("reports what the model read on a successful analysis", async () => {
    installFakeProvider(() => reply.json(VALID_FEEDBACK));

    const { resumeText } = await analyzeResume({
      jobTitle: JOB_TITLE,
      jobDescription: JOB_DESCRIPTION,
      resumeText: OVER_LIMIT,
    });

    expect(resumeText).toEqual({
      chars: MAX_RESUME_TEXT_CHARS + 7,
      charsSent: MAX_RESUME_TEXT_CHARS,
      truncated: true,
    });
  });
});
