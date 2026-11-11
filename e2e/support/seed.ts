import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import type { TestAccount } from "./accounts";

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
