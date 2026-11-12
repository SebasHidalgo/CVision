import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import type { TestAccount } from "./accounts";
import { seededReport } from "./fixtureReport";
import { standingFrom } from "@/lib/billing/access";
import { applyDevUsage, type DevUsageTarget } from "../../scripts/dev/usageState";

/**
 * A stored analysis for a test account, written straight to the database: the synthetic
 * tech-frontend-match fixture as production stores it (e2e/fixtures/analysis.json, rebuilt from the
 * eval's run when the analysis shape changes). For specs that need an analysis page, not a model call.
 * Its CV object does not exist; nothing here opens the drawer. The account's deletion removes it.
 * Its Spanish translation is stored too, unless `translated: false`.
 */
export async function seedAnalysis(account: Pick<TestAccount, "id">, { translated = true } = {}): Promise<string> {
  const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "e2e", "fixtures", "analysis.json"), "utf8"));
  const json = (value: unknown) => value as Prisma.InputJsonValue;
  const { feedback } = fixture;
  await db.user.upsert({ where: { id: account.id }, create: { id: account.id }, update: {} });
  const id = randomUUID();
  await db.resumeAnalysis.create({
    data: {
      id,
      userId: account.id,
      companyName: fixture.companyName,
      jobTitle: fixture.jobTitle,
      jobDescription: fixture.jobDescription,
      resumeKey: `cv/${account.id}/${randomUUID()}.pdf`,
      feedback: {
        create: {
          overall: json(feedback.overall),
          atsCompatibility: json(feedback.atsCompatibility),
          experienceAndImpact: json(feedback.experienceAndImpact),
          skills: json(feedback.skills),
          educationAndCertifications: json(feedback.educationAndCertifications),
          toneAndClarity: json(feedback.toneAndClarity),
          jobFit: json(feedback.jobFit),
        },
      },
    },
  });
  if (translated) await storeTranslation({ analysisId: id }, TRANSLATIONS.analysis);
  return id;
}

type StoredTranslation = { sourceHash: string; payload: unknown; model: string; modelVersion: string | null };
const TRANSLATIONS = JSON.parse(readFileSync(path.resolve(process.cwd(), "e2e", "fixtures", "translations.es.json"), "utf8")) as Record<"analysis" | "feedback", StoredTranslation>;

/** A ready Spanish translation, as the app stores one after translating. */
async function storeTranslation(parent: { analysisId: string } | { interviewFeedbackId: string }, stored: StoredTranslation) {
  await db.contentTranslation.create({
    data: { ...parent, locale: "es", status: "READY", sourceHash: stored.sourceHash, payload: stored.payload as Prisma.InputJsonValue, model: stored.model, modelVersion: stored.modelVersion },
  });
}

/**
 * A finished Spanish interview of that analysis, with its stored transcript and report (e2e/fixtures/interview-es.json,
 * invented): the feedback page as a real call leaves it, for the layout check. No call, no model; the report is
 * validated against the production schema so a stale fixture fails here, not as an "unavailable" page.
 */
export async function seedCompletedInterview(account: Pick<TestAccount, "id">, analysisId: string): Promise<string> {
  const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "e2e", "fixtures", "interview-es.json"), "utf8"));
  const report = seededReport(fixture);
  const last = await db.interview.findFirst({ where: { resumeAnalysisId: analysisId }, orderBy: { attemptNumber: "desc" }, select: { attemptNumber: true } });
  const id = randomUUID();
  const created = await db.interview.create({
    data: {
      id,
      userId: account.id,
      resumeAnalysisId: analysisId,
      attemptNumber: (last?.attemptNumber ?? 0) + 1,
      role: fixture.role,
      techstack: fixture.techstack,
      status: "COMPLETED",
      language: "es",
      tier: "TRIAL",
      startCount: 2,
      transcript: fixture.transcript as Prisma.InputJsonValue,
      transcriptSource: "seed",
      durationSeconds: 300,
      InterviewFeedback: { create: { totalScore: report.totalScore, report: report as unknown as Prisma.InputJsonValue } },
    },
    select: { InterviewFeedback: { select: { id: true } } },
  });
  if (created.InterviewFeedback) await storeTranslation({ interviewFeedbackId: created.InterviewFeedback.id }, TRANSLATIONS.feedback);
  return id;
}

/** Puts a test account's ledger in a state with the dev:usage tool's own core (no call, no purchase). */
export async function setUsage(account: Pick<TestAccount, "id">, target: DevUsageTarget) {
  await db.user.upsert({ where: { id: account.id }, create: { id: account.id }, update: {} });
  // Test accounts set up this way never subscribed: their standing is the comp alone.
  return applyDevUsage(db, account.id, target, async (id, now) => {
    const user = await db.user.findUnique({ where: { id }, select: { compPlan: true } });
    return standingFrom({ compPlan: user?.compPlan ?? null, subscriptions: [] }, now);
  });
}
