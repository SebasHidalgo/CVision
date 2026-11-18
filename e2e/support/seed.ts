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
 * Its Spanish translation is stored too, unless `translated: false` (or `requirements` changes the prose it hashes).
 * `requirements` rewrites the stored requirement list (the fixture's, in posting order); `createdAt` and `jobTitle`
 * set those columns.
 */
export async function seedAnalysis(
  account: Pick<TestAccount, "id">,
  {
    translated = true,
    requirements,
    createdAt,
    jobTitle,
  }: { translated?: boolean; requirements?: (list: SeededRequirement[]) => SeededRequirement[]; createdAt?: Date; jobTitle?: string } = {},
): Promise<string> {
  const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "e2e", "fixtures", "analysis.json"), "utf8"));
  const json = (value: unknown) => value as Prisma.InputJsonValue;
  const { feedback } = fixture;
  if (requirements) feedback.jobFit.requirements = requirements(feedback.jobFit.requirements);
  // Clerk's user.created webhook may insert the same row at this moment: an upsert races it, ON CONFLICT does not.
  await db.user.createMany({ data: [{ id: account.id }], skipDuplicates: true });
  const id = randomUUID();
  await db.resumeAnalysis.create({
    data: {
      id,
      userId: account.id,
      ...(createdAt ? { createdAt } : {}),
      companyName: fixture.companyName,
      jobTitle: jobTitle ?? fixture.jobTitle,
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
  if (translated && !requirements) await storeTranslation({ analysisId: id }, TRANSLATIONS.analysis);
  return id;
}

/** One stored requirement as the fixture has it; specs only rewrite these fields. */
export type SeededRequirement = { requirement: string; kind?: "required" | "preferred"; status: string; evidence: string; sourceQuote?: string } & Record<string, unknown>;

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

/**
 * An interview whose call just ended and whose record has not arrived: the feedback page waits on it. `complete()` then
 * stores what the webhook and the generator would (the same invented transcript and report), so a spec can check the
 * open page shows the feedback without a reload. No call, no model; the conversation id is invented and the platform is
 * never asked (the reconcile waits two minutes after the end).
 */
export async function seedInterviewAwaitingFeedback(account: Pick<TestAccount, "id">, analysisId: string): Promise<{ id: string; complete: () => Promise<void> }> {
  const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "e2e", "fixtures", "interview-es.json"), "utf8"));
  const report = seededReport(fixture);
  const last = await db.interview.findFirst({ where: { resumeAnalysisId: analysisId }, orderBy: { attemptNumber: "desc" }, select: { attemptNumber: true } });
  const id = randomUUID();
  const conversationId = `conv_e2e_${id.replace(/-/g, "")}`;
  const now = new Date();
  await db.interview.create({
    data: {
      id,
      userId: account.id,
      resumeAnalysisId: analysisId,
      attemptNumber: (last?.attemptNumber ?? 0) + 1,
      role: fixture.role,
      techstack: fixture.techstack,
      status: "IN_PROGRESS",
      language: "es",
      tier: "TRIAL",
      startCount: 1,
      conversationId,
      issuedConversationIds: [conversationId],
      startedAt: now,
      lastSessionAt: now,
      endedAt: now,
    },
  });
  return {
    id,
    complete: async () => {
      const created = await db.interview.update({
        where: { id },
        data: {
          status: "COMPLETED",
          transcript: fixture.transcript as Prisma.InputJsonValue,
          transcriptSource: "seed",
          durationSeconds: 300,
          InterviewFeedback: { create: { totalScore: report.totalScore, report: report as unknown as Prisma.InputJsonValue } },
        },
        select: { InterviewFeedback: { select: { id: true } } },
      });
      if (created.InterviewFeedback) await storeTranslation({ interviewFeedbackId: created.InterviewFeedback.id }, TRANSLATIONS.feedback);
    },
  };
}

/** Puts a test account's ledger in a state with the dev:usage tool's own core (no call, no purchase). */
export async function setUsage(account: Pick<TestAccount, "id">, target: DevUsageTarget) {
  // Clerk's user.created webhook may insert the same row at this moment: an upsert races it, ON CONFLICT does not.
  await db.user.createMany({ data: [{ id: account.id }], skipDuplicates: true });
  // Test accounts set up this way never subscribed: their standing is the comp alone.
  return applyDevUsage(db, account.id, target, async (id, now) => {
    const user = await db.user.findUnique({ where: { id }, select: { compPlan: true } });
    return standingFrom({ compPlan: user?.compPlan ?? null, subscriptions: [] }, now);
  });
}
