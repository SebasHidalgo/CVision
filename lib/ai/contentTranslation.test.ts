import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

vi.mock("@/lib/database/translation", () => ({
  claimTranslation: vi.fn(),
  completeTranslation: vi.fn(async () => true),
  failTranslation: vi.fn(async () => {}),
  readTranslation: vi.fn(async () => null),
  readOwnTranslation: vi.fn(async () => null),
  TRANSLATION_RETRY_AFTER_MS: 600_000,
}));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/ai/translation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/translation")>();
  return { ...actual, translateContent: vi.fn() };
});

const { claimTranslation, completeTranslation, failTranslation, readTranslation, readOwnTranslation } = await import("@/lib/database/translation");
const { assertRateLimit } = await import("@/lib/database/rateLimit");
const { translateContent, translationSourceHash } = await import("@/lib/ai/translation");
const { localizedAnalysis, translateAnalysis, analysisTranslationInput, translationIncrements } = await import("./contentTranslation");
const { PENDING_PROSE } = await import("@/lib/i18n/analysisView");
const { RateLimitedError } = await import("@/lib/error/errors");

const FEEDBACK = {
  overall: { qualityScore: 70, summaryText: "A clear CV.", headline: [{ key: "allMet" }], prioritizedFixes: [] },
  atsCompatibility: { description: "Reads cleanly.", encodingArtifacts: [], sectionsDetected: [], problems: [], fixes: [], evidence: [] },
  experienceAndImpact: { score: 60, description: "Results are thin.", quantifiedAchievements: [], strengths: [], weaknesses: [], suggestedBullets: [] },
  skills: { score: 70, description: "The stack matches.", matchedSkills: [], actionPlan: [] },
  educationAndCertifications: { score: 50, description: "A relevant degree.", highlights: [], improvements: [] },
  toneAndClarity: { description: "Direct.", suggestions: [] },
  jobFit: { description: "", outcomes: [], strategicRecommendations: [], requirements: [] },
} as ResumeAnalysisFeedback;
const ANALYSIS = { id: "a1", companyName: "Acme", jobTitle: "Data Analyst", feedback: FEEDBACK };
const ROW = { id: "t1", claimedAt: new Date("2026-11-10T00:00:00Z") };
const later = () => Date.now() + 25_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const hashOf = (analysis: typeof ANALYSIS) => {
  const job = analysisTranslationInput(analysis);
  return translationSourceHash(job.sources, "es", job.terms, job.names);
};

const STATS = {
  strings: 6,
  kept: 5,
  calls: 2,
  retried: 1,
  counts: { length: 1 },
  remaining: { length: 1 },
  fallbacks: 1,
  failures: [],
  terms: { total: 0, names: 0, concepts: 0, forced: 0, fallbacks: 0 },
  protectedTerms: { present: 0, preserved: 0 },
  digits: { present: 0, preserved: 0 },
};

describe("translateAnalysis", () => {
  it("does nothing for English, the canonical language", async () => {
    expect(await translateAnalysis("u1", ANALYSIS, "en", later())).toBe("unneeded");
    expect(claimTranslation).not.toHaveBeenCalled();
  });

  it("serves a stored translation without a call", async () => {
    vi.mocked(claimTranslation).mockResolvedValue({ kind: "ready", row: ROW as never });
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("ready");
    expect(translateContent).not.toHaveBeenCalled();
  });

  it("translates once when it holds the claim, stores what passed with counts, and logs a fallback as an error", async () => {
    vi.mocked(claimTranslation).mockResolvedValue({ kind: "claimed", row: ROW as never });
    const payload = { strings: { "overall.summaryText": "Un CV claro." }, terms: {} };
    vi.mocked(translateContent).mockResolvedValue({
      payload,
      translated: {},
      decisions: [],
      stats: STATS,
      model: "gemini-3.5-flash-lite",
      modelVersion: "v1",
      input: 100,
      output: 50,
      fallbacks: [{ path: "toneAndClarity.description", checks: ["length"] }],
    });
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("ready");
    expect(assertRateLimit).toHaveBeenCalledWith("u1", "translation");
    expect(completeTranslation).toHaveBeenCalledWith(
      "t1",
      ROW.claimedAt,
      expect.objectContaining({ payload, model: "gemini-3.5-flash-lite", modelVersion: "v1" }),
      { kind: "ANALYSIS", increments: translationIncrements(STATS) },
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("fell back to English a1 es: toneAndClarity.description (length)"));
  });

  it("waits for another tab's claim instead of paying twice", async () => {
    const hash = hashOf(ANALYSIS);
    vi.mocked(claimTranslation).mockResolvedValue({ kind: "busy" });
    vi.mocked(readTranslation).mockResolvedValue({ status: "READY", sourceHash: hash } as never);
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("ready");
    expect(translateContent).not.toHaveBeenCalled();
  });

  it("records a failed call or a rate limit, and never throws", async () => {
    vi.mocked(claimTranslation).mockResolvedValue({ kind: "claimed", row: ROW as never });
    vi.mocked(translateContent).mockRejectedValue(new Error("boom"));
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("failed");
    expect(failTranslation).toHaveBeenCalledWith("t1", ROW.claimedAt);

    vi.mocked(assertRateLimit).mockRejectedValueOnce(new RateLimitedError(60));
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("failed");
    expect(translateContent).toHaveBeenCalledTimes(1);
  });
});

describe("localizedAnalysis", () => {
  const hash = hashOf(ANALYSIS);

  it("renders English as stored, with the code's sentences in English", async () => {
    const { feedback, state } = await localizedAnalysis(ANALYSIS, "en");
    expect(state).toBe("none");
    expect(feedback.overall.summaryText).toBe("You meet every required qualification. A clear CV.");
  });

  it("serves the stored translation with the code's sentences in Spanish", async () => {
    vi.mocked(readOwnTranslation).mockResolvedValue({ status: "READY", sourceHash: hash, payload: { strings: { "overall.summaryText": "Un CV claro." }, terms: {} }, guardStats: { strings: 6, kept: 6 } } as never);
    const { feedback, state } = await localizedAnalysis(ANALYSIS, "es");
    expect(state).toBe("ready");
    expect(feedback.overall.summaryText).toBe("Cumples todos los requisitos obligatorios. Un CV claro.");
  });

  it("says partial when some strings kept their English, pending without a current row, unavailable after a recent failure", async () => {
    vi.mocked(readOwnTranslation).mockResolvedValueOnce({ status: "READY", sourceHash: hash, payload: {}, guardStats: { strings: 6, kept: 5 } } as never);
    expect((await localizedAnalysis(ANALYSIS, "es")).state).toBe("partial");
    vi.mocked(readOwnTranslation).mockResolvedValueOnce({ status: "READY", sourceHash: "stale", payload: {} } as never);
    const pending = await localizedAnalysis(ANALYSIS, "es");
    expect(pending.state).toBe("pending");
    // Pending: the prose waits behind its skeleton; scores and statuses are there.
    expect(pending.feedback.overall.summaryText).toBe(PENDING_PROSE);
    expect(pending.feedback.skills.description).toBe(PENDING_PROSE);
    expect(pending.feedback.overall.qualityScore).toBe(70);
    vi.mocked(readOwnTranslation).mockResolvedValueOnce({ status: "FAILED", sourceHash: hash, failedAt: new Date() } as never);
    expect((await localizedAnalysis(ANALYSIS, "es")).state).toBe("unavailable");
    vi.mocked(readOwnTranslation).mockResolvedValueOnce({ status: "FAILED", sourceHash: hash, failedAt: new Date(Date.now() - 3_600_000) } as never);
    expect((await localizedAnalysis(ANALYSIS, "es")).state).toBe("pending");
  });

  it("shows the original on request without asking for a translation", async () => {
    const { state, feedback } = await localizedAnalysis(ANALYSIS, "es", { original: true });
    expect(state).toBe("unavailable");
    expect(feedback.overall.summaryText).toBe("Cumples todos los requisitos obligatorios. A clear CV.");
    expect(readOwnTranslation).not.toHaveBeenCalled();
  });
});

describe("localizedAnalysis with sentence terms", () => {
  const WITH_TERMS = {
    ...ANALYSIS,
    feedback: {
      ...FEEDBACK,
      jobFit: { ...FEEDBACK.jobFit, outcomes: [{ key: "notShown", params: { absent: "software architecture" } }] },
    } as ResumeAnalysisFeedback,
  };

  it("renders the posting's generic terms in the target language from the stored terms", async () => {
    vi.mocked(readOwnTranslation).mockResolvedValue({
      status: "READY",
      sourceHash: hashOf(WITH_TERMS),
      payload: { strings: {}, terms: { "software architecture": "arquitectura de software" } },
      guardStats: { strings: 6, kept: 6 },
    } as never);
    const { feedback } = await localizedAnalysis(WITH_TERMS, "es");
    expect(feedback.jobFit.description).toBe("Tu CV no muestra arquitectura de software.");
  });

  it("keeps the sentence verbatim in English, and pending in Spanish until the terms arrive", async () => {
    expect((await localizedAnalysis(WITH_TERMS, "en")).feedback.jobFit.description).toBe("Your CV doesn't show software architecture.");
    vi.mocked(readOwnTranslation).mockResolvedValue(null);
    expect((await localizedAnalysis(WITH_TERMS, "es")).feedback.jobFit.description).toBe(PENDING_PROSE);
  });
});

describe("translationIncrements", () => {
  it("counts the day: one recorded, first-answer failures, what retries left, and fallbacks", () => {
    expect(translationIncrements(STATS)).toEqual([
      { check: "translation", action: "recorded", count: 1 },
      { check: "translation:length", action: "failed-first", count: 1 },
      { check: "translation:length", action: "after-retries", count: 1 },
      { check: "translation", action: "fallback", count: 1 },
    ]);
  });
});
