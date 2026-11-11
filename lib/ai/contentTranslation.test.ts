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
  return { ...actual, translateProse: vi.fn() };
});

const { claimTranslation, completeTranslation, failTranslation, readTranslation, readOwnTranslation } = await import("@/lib/database/translation");
const { assertRateLimit } = await import("@/lib/database/rateLimit");
const { translateProse, translationSourceHash } = await import("@/lib/ai/translation");
const { localizedAnalysis, translateAnalysis, analysisTranslationInput } = await import("./contentTranslation");
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
});

describe("translateAnalysis", () => {
  it("does nothing for English, the canonical language", async () => {
    expect(await translateAnalysis("u1", ANALYSIS, "en", later())).toBe("unneeded");
    expect(claimTranslation).not.toHaveBeenCalled();
  });

  it("serves a stored translation without a call", async () => {
    vi.mocked(claimTranslation).mockResolvedValue({ kind: "ready", row: ROW as never });
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("ready");
    expect(translateProse).not.toHaveBeenCalled();
  });

  it("translates once when it holds the claim, and stores only what passed with counts", async () => {
    vi.mocked(claimTranslation).mockResolvedValue({ kind: "claimed", row: ROW as never });
    vi.mocked(translateProse).mockResolvedValue({
      kept: { "overall.summaryText": "Un CV claro." },
      translated: { "overall.summaryText": "Un CV claro." },
      stats: { strings: 6, kept: 1, counts: { length: 5 }, failures: [], protectedTerms: { present: 0, preserved: 0 }, digits: { present: 0, preserved: 0 } },
      model: "gemini-3.5-flash-lite",
      modelVersion: "v1",
      input: 100,
      output: 50,
    });
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("ready");
    expect(assertRateLimit).toHaveBeenCalledWith("u1", "translation");
    expect(completeTranslation).toHaveBeenCalledWith("t1", ROW.claimedAt, expect.objectContaining({ payload: { "overall.summaryText": "Un CV claro." }, model: "gemini-3.5-flash-lite", modelVersion: "v1" }));
  });

  it("waits for another tab's claim instead of paying twice", async () => {
    const hash = translationSourceHash(analysisTranslationInput(ANALYSIS).sources, "es");
    vi.mocked(claimTranslation).mockResolvedValue({ kind: "busy" });
    vi.mocked(readTranslation).mockResolvedValue({ status: "READY", sourceHash: hash } as never);
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("ready");
    expect(translateProse).not.toHaveBeenCalled();
  });

  it("records a failed call or a rate limit, and never throws", async () => {
    vi.mocked(claimTranslation).mockResolvedValue({ kind: "claimed", row: ROW as never });
    vi.mocked(translateProse).mockRejectedValue(new Error("boom"));
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("failed");
    expect(failTranslation).toHaveBeenCalledWith("t1", ROW.claimedAt);

    vi.mocked(assertRateLimit).mockRejectedValueOnce(new RateLimitedError(60));
    expect(await translateAnalysis("u1", ANALYSIS, "es", later())).toBe("failed");
    expect(translateProse).toHaveBeenCalledTimes(1);
  });
});

describe("localizedAnalysis", () => {
  const hash = translationSourceHash(analysisTranslationInput(ANALYSIS).sources, "es");

  it("renders English as stored, with the code's sentences in English", async () => {
    const { feedback, state } = await localizedAnalysis(ANALYSIS, "en");
    expect(state).toBe("none");
    expect(feedback.overall.summaryText).toBe("You meet every required qualification. A clear CV.");
  });

  it("serves the stored translation with the code's sentences in Spanish", async () => {
    vi.mocked(readOwnTranslation).mockResolvedValue({ status: "READY", sourceHash: hash, payload: { "overall.summaryText": "Un CV claro." }, guardStats: { strings: 6, kept: 6 } } as never);
    const { feedback, state } = await localizedAnalysis(ANALYSIS, "es");
    expect(state).toBe("ready");
    expect(feedback.overall.summaryText).toBe("Cumples todos los requisitos obligatorios. Un CV claro.");
  });

  it("says partial when some strings kept their English, pending without a current row, unavailable after a recent failure", async () => {
    vi.mocked(readOwnTranslation).mockResolvedValueOnce({ status: "READY", sourceHash: hash, payload: {}, guardStats: { strings: 6, kept: 5 } } as never);
    expect((await localizedAnalysis(ANALYSIS, "es")).state).toBe("partial");
    vi.mocked(readOwnTranslation).mockResolvedValueOnce({ status: "READY", sourceHash: "stale", payload: {} } as never);
    expect((await localizedAnalysis(ANALYSIS, "es")).state).toBe("pending");
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
