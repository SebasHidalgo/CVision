import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, type InterviewStatus } from "@prisma/client";
import { db } from "./db";
import type { TestAccount } from "./accounts";

/**
 * Interviews in each state the interviews list tells apart, written straight to the database: no call, no model, no
 * platform. Each row is a rehearsal of the given analysis with the next attempt number, created `minutesAgo` before now
 * so a spec controls the list's order. A row that waits (scheduled, live, resumable) holds an invented unit id; nothing
 * reserves or refunds it here. A resumable one stays resumable for ten minutes, and nothing about these rows calls the
 * model unless its feedback page is opened (a FEEDBACK_PENDING row's page would generate): specs only read the list.
 */

export type ListSeedState = "scheduled" | "live" | "dropped" | "endedEarly" | "pending" | "failed" | "expired";

const FIXTURE = () => JSON.parse(readFileSync(path.resolve(process.cwd(), "e2e", "fixtures", "interview-es.json"), "utf8")) as { role: string; techstack: string[]; transcript: unknown[] };

/** The first exchange of the fixture call: the interviewer asks, the candidate answers (the call counted). */
const firstCall = () => FIXTURE().transcript.slice(0, 2);

export async function seedListInterview(
  account: Pick<TestAccount, "id">,
  analysisId: string,
  state: ListSeedState,
  { minutesAgo = 0, role }: { minutesAgo?: number; role?: string } = {},
): Promise<string> {
  const fixture = FIXTURE();
  const now = Date.now();
  const at = (minutes: number) => new Date(now - minutes * 60_000);
  const last = await db.interview.findFirst({ where: { resumeAnalysisId: analysisId }, orderBy: { attemptNumber: "desc" }, select: { attemptNumber: true } });
  const id = randomUUID();
  const conversationId = `conv_e2e_${id.replace(/-/g, "")}`;
  const session = { conversationId, issuedConversationIds: [conversationId], startCount: 1, startedAt: at(3), lastSessionAt: at(3), usageEventId: `e2e-${id}`, tier: "FULL" as const, paidBy: "PERIOD" as const };
  const dropped = (reason: "disconnect" | "interviewer") => ({
    ...session,
    status: "IN_PROGRESS" as InterviewStatus,
    transcript: firstCall() as Prisma.InputJsonValue,
    transcriptSource: "seed",
    durationSeconds: 60,
    endedAt: at(1),
    resumableUntil: new Date(now + 10 * 60_000),
    callEnd: { reason, detail: reason === "interviewer" ? "time_up" : null, roomSeconds: 60, recorded: true },
  });

  const byState: Record<ListSeedState, Partial<Prisma.InterviewUncheckedCreateInput>> = {
    scheduled: { status: "SCHEDULED" },
    live: { ...session, status: "IN_PROGRESS" },
    dropped: dropped("disconnect"),
    endedEarly: dropped("interviewer"),
    // A live generator's claim, not FEEDBACK_PENDING: a pending row's feedback page would start the generator (a Gemini call).
    pending: { ...session, status: "GENERATING", feedbackStartedAt: new Date(now + 60 * 60_000), transcript: fixture.transcript as Prisma.InputJsonValue, transcriptSource: "seed", durationSeconds: 300, endedAt: at(1) },
    failed: { status: "FAILED", failureReason: "NO_CANDIDATE_TURNS", startCount: 3 },
    expired: { status: "EXPIRED", failureReason: "ABANDONED", startCount: 1 },
  };

  await db.interview.create({
    data: {
      ...byState[state],
      id,
      userId: account.id,
      resumeAnalysisId: analysisId,
      attemptNumber: (last?.attemptNumber ?? 0) + 1,
      role: role ?? fixture.role,
      techstack: fixture.techstack,
      createdAt: at(minutesAgo),
    },
  });
  return id;
}

/**
 * The feedback page's states with no report to show, each from a row that asks nothing of the platform or the model:
 * `silent` (a call nobody spoke in, its record stored: "not scored" with ?ended=1), `feedbackFailed` (the scoring gave
 * up twice: the retry is offered, never pressed), `unreadable` (a stored report outside the schema).
 */
export async function seedFeedbackState(account: Pick<TestAccount, "id">, analysisId: string, kind: "silent" | "feedbackFailed" | "unreadable"): Promise<string> {
  const id = await seedListInterview(account, analysisId, "scheduled");
  const conversationId = `conv_e2e_${id.replace(/-/g, "")}`;
  const agentOnly = FIXTURE().transcript.slice(0, 1) as Prisma.InputJsonValue;
  if (kind === "silent") {
    await db.interview.update({
      where: { id },
      data: { status: "IN_PROGRESS", failureReason: "NO_CANDIDATE_TURNS", startCount: 1, conversationId, issuedConversationIds: [conversationId], transcript: agentOnly, transcriptSource: "seed", startedAt: new Date(), lastSessionAt: new Date(), endedAt: new Date() },
    });
  } else if (kind === "feedbackFailed") {
    await db.interview.update({ where: { id }, data: { status: "FAILED", failureReason: "FEEDBACK_FAILED", startCount: 1, transcript: firstCall() as Prisma.InputJsonValue, transcriptSource: "seed" } });
  } else {
    await db.interview.update({ where: { id }, data: { status: "COMPLETED", startCount: 1, InterviewFeedback: { create: { totalScore: 50, report: { shape: "before M3-B" } } } } });
  }
  return id;
}

/** Moves an interview's creation time, so a seeded finished interview takes its place in the list's order. */
export async function setCreatedAt(interviewId: string, minutesAgo: number): Promise<void> {
  await db.interview.update({ where: { id: interviewId }, data: { createdAt: new Date(Date.now() - minutesAgo * 60_000) } });
}

/** Renames an interview's role, so a spec can tell seeded interviews of the same fixture apart in a list. */
export async function setRole(interviewId: string, role: string): Promise<void> {
  await db.interview.update({ where: { id: interviewId }, data: { role } });
}
