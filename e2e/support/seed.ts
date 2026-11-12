import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import type { TestAccount } from "./accounts";
import { FEEDBACK_CATEGORIES, interviewFeedbackReportSchema } from "@/lib/ai/schemas";
import { standingFrom } from "@/lib/billing/access";
import { applyDevUsage, type DevUsageTarget } from "../../scripts/dev/usageState";

/**
 * A stored analysis for a test account, written straight to the database: the synthetic
 * tech-frontend-match fixture as production stores it (e2e/fixtures/analysis.json, rebuilt from the
 * eval's run when the analysis shape changes). For specs that need an analysis page, not a model call.
 * Its CV object does not exist; nothing here opens the drawer. The account's deletion removes it.
 */
export async function seedAnalysis(account: Pick<TestAccount, "id">): Promise<string> {
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
  return id;
}

/**
 * A finished Spanish interview of that analysis, with its stored transcript and report (e2e/fixtures/interview-es.json,
 * invented): the feedback page as a real call leaves it, for the layout check. No call, no model; the report is
 * validated against the production schema so a stale fixture fails here, not as an "unavailable" page.
 */
export async function seedCompletedInterview(account: Pick<TestAccount, "id">, analysisId: string): Promise<string> {
  const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "e2e", "fixtures", "interview-es.json"), "utf8"));
  const report = interviewFeedbackReportSchema.parse({
    ...fixture.report,
    categoryScores: FEEDBACK_CATEGORIES.map((name, i) => ({ name, score: 60 + i * 4, comment: `Steady on ${name.toLowerCase()}, with one concrete example.` })),
  });
  const last = await db.interview.findFirst({ where: { resumeAnalysisId: analysisId }, orderBy: { attemptNumber: "desc" }, select: { attemptNumber: true } });
  const id = randomUUID();
  await db.interview.create({
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
  });
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
