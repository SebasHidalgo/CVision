import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "@/lib/pdfParse";
import { analyzeResumeAction } from "@/screens/ResumeUpload/actions/analyzeResumeAction";
import golden from "./analysisRequest.golden.json";
import { installFakeProvider, reply, type ProviderRequest } from "./client.stub";
import {
  analyzeResume,
  MAX_RESUME_TEXT_CHARS,
  truncateResumeText,
} from "./resumeAnalysis";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/database/user", () => ({ ensureUser: vi.fn(async () => "user_1") }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/database/usage", () => ({
  reserveUsage: vi.fn(async () => ({ eventId: "evt_1" })),
  refundUsage: vi.fn(async () => true),
}));
vi.mock("@/lib/pdfParse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdfParse")>();
  return { ...actual, extractPdfText: vi.fn() };
});
vi.mock("@/lib/supabase/server", () => ({
  // Bytes that begin as a PDF does; the parser itself is stubbed above.
  downloadObject: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])),
  removeObject: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/resume", () => ({
  createResume: vi.fn(async () => "resume_1"),
}));

// The inputs the golden was recorded with. Changing one invalidates it.
const JOB_TITLE = "Frontend Engineer";
const JOB_DESCRIPTION = "Build the checkout in React and TypeScript. Testing matters.";
const SHORT_CV = "Jane Doe. Frontend engineer. React, TypeScript. BSc 2018.";
// The prompt carries the current date, so the golden is recorded on a fixed
// one. Only Date is faked: the client's own timers have to keep working.
const RECORDED_ON = new Date("2026-10-02T12:00:00Z");

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
  vi.mocked(extractPdfText).mockResolvedValue({ text: resumeText, accentsComposed: 0 });

  return requestFrom(() =>
    analyzeResumeAction({
      companyName: "Northwind",
      jobTitle: JOB_TITLE,
      jobDescription: JOB_DESCRIPTION,
      resumeKey: "cv/user_1/11111111-2222-4333-8444-555555555555.pdf",
    }),
  );
}

/** The smallest answer that satisfies resumeFeedbackSchema. */
const SECTION = { score: 70, description: "" };
const VALID_FEEDBACK = {
  overall: { qualityScore: 55, summaryText: "", prioritizedFixes: [] },
  atsCompatibility: {
    description: "",
    encodingArtifacts: [],
    sectionsDetected: [],
    issues: [],
    evidence: [],
  },
  experienceAndImpact: {
    ...SECTION,
    quantifiedAchievements: [],
    strengths: [],
    weaknesses: [],
    suggestedBullets: [],
  },
  skills: { ...SECTION, matchedSkills: [], actionPlan: [] },
  educationAndCertifications: {
    ...SECTION,
    highlights: [],
    improvements: [],
  },
  toneAndClarity: { description: "", suggestions: [] },
  jobFit: { description: "", requirements: [], strategicRecommendations: [] },
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(RECORDED_ON);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

/*
 * analysisRequest.golden.json was recorded from analyzeResumeAction at commit
 * e7b98d6, before the model step moved into analyzeResume, and proved that
 * refactor put the same bytes on the wire. M2c-D rewrote the prompt on
 * purpose, so it was re-recorded there, on the frozen date above.
 *
 * What it still pins is worth keeping: the two call sites send one identical
 * request, and nothing reaches the prompt by accident. The equality test below
 * is the invariant; the golden is the anchor that makes an unintended edit
 * visible. The original byte-identity proof stays in the history at 7543dd1.
 */
describe("both call sites send exactly one, identical request", () => {
  it("from the Server Action", async () => {
    expect(await viaActionPath(SHORT_CV)).toEqual(golden.typical);
  });

  it("from analyzeResume, which the harness calls", async () => {
    expect(await viaHarnessPath(SHORT_CV)).toEqual(golden.typical);
  });
});

/*
 * The model cannot tell a finished degree from an ongoing one without knowing
 * what day it is: an eval run described a degree that ended in the past as
 * still in progress. The date has to come from the request, not from the
 * build, or every deploy freezes "today" until the next one.
 */
describe("the date anchor", () => {
  const dateIn = (prompt: string) => /Today is (\S+) \(([^)]+)\)/.exec(prompt);

  it("states today's date, machine-readable and written out", async () => {
    const { prompt } = await viaHarnessPath(SHORT_CV);

    expect(dateIn(prompt)?.slice(1)).toEqual(["2026-10-02", "October 2, 2026"]);
  });

  it("is resolved per request, not at import time", async () => {
    vi.setSystemTime(new Date("2027-03-15T12:00:00Z"));

    const { prompt } = await viaHarnessPath(SHORT_CV);

    expect(dateIn(prompt)?.slice(1)).toEqual(["2027-03-15", "March 15, 2027"]);
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

  it("applies the requirement rules on the way out and counts them in the guard report", async () => {
    const clause = { quote: "", status: "missing", evidence: "", note: "" };
    const entry = (over: Record<string, unknown>) => ({
      sourceQuote: "Build the checkout in React and TypeScript.",
      heading: "",
      section: "requirements",
      demandsCapability: true,
      requirement: "React and TypeScript",
      kind: "required",
      softenedClause: clause,
      assessable: true,
      status: "met",
      evidence: "React, TypeScript",
      note: "",
      keyTerms: { mode: "all", terms: [] },

      yearsEvidence: [],
      ...over,
    });
    installFakeProvider(() =>
      reply.json({
        ...VALID_FEEDBACK,
        jobFit: {
          ...VALID_FEEDBACK.jobFit,
          requirements: [
            entry({ softenedClause: { quote: "Accessibility is a plus.", status: "missing", evidence: "", note: "" } }),
            entry({ sourceQuote: "Five years of Go.", requirement: "Go" }),
            entry({ sourceQuote: "Testing matters.", requirement: "Testing", status: "met", evidence: "Wrote tests every day" }),
          ],
        },
      }),
    );

    const { feedback, guard } = await analyzeResume({ jobTitle: JOB_TITLE, jobDescription: `${JOB_DESCRIPTION} Accessibility is a plus.`, resumeText: SHORT_CV });

    expect(feedback.jobFit.requirements.map((one) => [one.requirement, one.kind, one.status])).toEqual([
      ["React and TypeScript", "required", "met"],
      ["Accessibility is a plus", "preferred", "missing"],
      ["Testing", "required", "missing"],
    ]);
    expect(guard.counts).toMatchObject({ "requirement-dropped": 1, "requirement-split": 1, "quote-dropped": 1, "status-downgraded": 1 });
    // The headline comes from the statuses, ahead of the model's summary.
    expect(feedback.overall.summaryText).toBe("Core gaps: Testing.");
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

describe("the analysis language", () => {
  const SPANISH = {
    ...VALID_FEEDBACK,
    overall: { ...VALID_FEEDBACK.overall, summaryText: "Tu experiencia es sólida para el puesto y los proyectos de la empresa muestran que trabajas con el equipo." },
  };

  it("asks once more, with the English line, when the prose comes back in Spanish", async () => {
    const provider = installFakeProvider(() => reply.json(provider.requests.length === 1 ? SPANISH : VALID_FEEDBACK));
    const { guard } = await analyzeResume({ jobTitle: JOB_TITLE, jobDescription: JOB_DESCRIPTION, resumeText: SHORT_CV });

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].prompt).toContain("Your previous answer was not written in English.");
    expect(guard.interventions).toContainEqual(expect.objectContaining({ check: "language", action: "regenerated", value: "1 field(s) not in English", replacement: "0 after asking again" }));
  });

  it("keeps the first answer when the second call fails", async () => {
    const provider = installFakeProvider(() => (provider.requests.length === 1 ? reply.json(SPANISH) : reply.error(503)));
    const { feedback } = await analyzeResume({ jobTitle: JOB_TITLE, jobDescription: JOB_DESCRIPTION, resumeText: SHORT_CV });

    expect(provider.requests).toHaveLength(2);
    expect(feedback.overall.summaryText).toContain("Tu experiencia");
  });
});

describe("the requirement repair", () => {
  const POSTING = "Frontend Engineer\n\nRequirements\n- 3+ years with React and TypeScript.\n- A degree in Computer Science or equivalent experience.";
  const clause = { quote: "", status: "missing", evidence: "", note: "" };
  const entry = (sourceQuote: string, requirement: string) => ({
    sourceQuote,
    heading: "Requirements",
    section: "requirements",
    demandsCapability: true,
    requirement,
    softenedClause: clause,
    keyTerms: { mode: "all", terms: [] },
    kind: "required",
    assessable: true,
    yearsEvidence: [],
    evidence: "",
    status: "missing",
    note: "",
  });
  const REACT = entry("3+ years with React and TypeScript.", "3+ years with React and TypeScript");
  const DEGREE = entry("A degree in Computer Science or equivalent experience.", "A degree in Computer Science or equivalent experience");
  const answer = (requirements: unknown[]) => ({ ...VALID_FEEDBACK, jobFit: { ...VALID_FEEDBACK.jobFit, requirements } });

  it("makes no second call when every qualification line is covered", async () => {
    const provider = installFakeProvider(() => reply.json(answer([REACT, DEGREE])));
    const { model } = await analyzeResume({ jobTitle: JOB_TITLE, jobDescription: POSTING, resumeText: SHORT_CV });

    expect(provider.requests).toHaveLength(1);
    expect(model?.repair).toBeUndefined();
  });

  it("asks once for the skipped line and merges the entry before the guards", async () => {
    const provider = installFakeProvider(() => reply.json(provider.requests.length === 1 ? answer([REACT]) : { requirements: [DEGREE] }));
    const { feedback, guard, model } = await analyzeResume({ jobTitle: JOB_TITLE, jobDescription: POSTING, resumeText: SHORT_CV, logId: "resume_9" });

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].prompt).toContain("1. A degree in Computer Science or equivalent experience.");
    expect(provider.requests[1].prompt).toContain("1. 3+ years with React and TypeScript");
    expect(feedback.jobFit.requirements.map((one) => one.requirement)).toEqual([
      "3+ years with React and TypeScript",
      "A degree in Computer Science or equivalent experience",
    ]);
    expect(guard.counts).toMatchObject({ "requirement-uncovered": 1, "requirement-recovered": 1 });
    expect(model?.repair?.requirements).toHaveLength(1);
    // Counts and the id only: the line itself is posting text.
    expect(warn).toHaveBeenCalledWith("[CVision][ai] requirement lines uncovered: 1 (resume_9)");
    expect(warn).toHaveBeenCalledWith("[CVision][ai] requirement repair: 1 of 1 line(s) covered (resume_9)");
  });

  it("keeps the analysis when the repair fails, and records it", async () => {
    const provider = installFakeProvider(() => (provider.requests.length === 1 ? reply.json(answer([REACT])) : reply.error(503)));
    const { feedback, guard } = await analyzeResume({ jobTitle: JOB_TITLE, jobDescription: POSTING, resumeText: SHORT_CV, logId: "resume_9" });

    expect(provider.requests).toHaveLength(2);
    expect(feedback.jobFit.requirements).toHaveLength(1);
    expect(guard.interventions).toContainEqual(expect.objectContaining({ check: "requirement-coverage", action: "recorded", replacement: "repair failed: AI_UNAVAILABLE" }));
    expect(warn).toHaveBeenCalledWith("[CVision][ai] requirement repair failed: AI_UNAVAILABLE (resume_9)");
  });
});
