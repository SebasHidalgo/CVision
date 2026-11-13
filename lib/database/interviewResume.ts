import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { handleError } from "@/lib/error/handleError";
import { hasCandidateTurns, finalizeFromStored } from "@/lib/voice/postCall";
import { readCallEnd } from "@/lib/voice/callEnd";
import { readSegments, RESUME_WINDOW_MS, type CallSegment } from "@/lib/voice/segments";
import { transcriptTurnSchema } from "@/lib/voice/transcript";
import { z } from "zod";

/**
 * Making a resumable interview final without a new call record: its resume
 * window lapsed, the candidate asked to finish, or its latest call left no
 * record. No session: the callers pass ids they resolved (a sweep scoped by
 * the user, a route that checked ownership, the reconcile).
 */

const LOG = "[CVision][resume]";

/** A latest call with no record after this long is not coming: score the earlier calls. */
export const UNRECORDED_CALL_GIVE_UP_MS = 30 * 60_000;

const resumeSelect = {
  id: true,
  status: true,
  conversationId: true,
  transcript: true,
  transcriptSource: true,
  segments: true,
  durationSeconds: true,
  endedAt: true,
  lastSessionAt: true,
  resumableUntil: true,
  callEnd: true,
} satisfies Prisma.InterviewSelect;

type ResumeRow = Prisma.InterviewGetPayload<{ select: typeof resumeSelect }>;

const turnsSchema = z.array(transcriptTurnSchema);

/** The latest call as a segment, when its record is stored. */
function latestSegment(row: ResumeRow): CallSegment | null {
  if (!row.transcriptSource || !row.conversationId) return null;
  const turns = turnsSchema.safeParse(row.transcript);
  if (!turns.success) return null;
  const durationSeconds = Math.max(0, row.durationSeconds ?? 0);
  return {
    conversationId: row.conversationId,
    turns: turns.data,
    durationSeconds,
    startTimeSeconds: row.endedAt ? Math.round(row.endedAt.getTime() / 1000) - durationSeconds : null,
    ...(readCallEnd(row.callEnd) ? { end: readCallEnd(row.callEnd)! } : {}),
  };
}

export type FinalizeResult = "finalized" | "nothing-to-score" | "not-ready" | "not-found";

/**
 * Scores the interview with what exists. `latestMissing` says the latest
 * call will never have a record (the platform lost it, or it is long
 * overdue), so the earlier calls stand alone. One guarded write: a session
 * issued in between (the candidate did come back) wins.
 */
export async function finalizeResumableInterview(interviewId: string, { latestMissing = false }: { latestMissing?: boolean } = {}): Promise<FinalizeResult> {
  try {
    const row = await prisma.interview.findUnique({ where: { id: interviewId }, select: resumeSelect });
    if (!row || row.status !== "IN_PROGRESS") return "not-found";

    const latest = latestSegment(row);
    if (!latest && !latestMissing) return "not-ready";

    const merged = finalizeFromStored({ segments: readSegments(row.segments), latest });
    if (!merged) {
      // Nobody ever spoke: not an interview to score. The ordinary paths (a new start, the expiry) take it from here.
      await prisma.interview.updateMany({ where: { id: row.id, status: "IN_PROGRESS", conversationId: row.conversationId }, data: { resumableUntil: null, finishRequestedAt: null } });
      return "nothing-to-score";
    }

    const updated = await prisma.interview.updateMany({
      where: { id: row.id, status: "IN_PROGRESS", conversationId: row.conversationId },
      data: {
        status: "FEEDBACK_PENDING",
        transcript: merged.transcript as Prisma.InputJsonValue,
        transcriptSource: row.transcriptSource ?? "elevenlabs",
        durationSeconds: merged.durationSeconds,
        segments: merged.segments ? (merged.segments as Prisma.InputJsonValue) : Prisma.DbNull,
        failureReason: null,
        resumableUntil: null,
      },
    });
    if (updated.count !== 1) return "not-found";
    console.info(`${LOG} interview=${row.id} final: ${merged.segments?.length ?? 1} call(s), ${merged.durationSeconds} s${latestMissing && !latest ? " (the latest call left no record)" : ""}`);
    return "finalized";
  } catch (error) {
    handleError(error, "Failed to finalize a resumable interview");
  }
}

/**
 * The lazy sweep: every interview of the user whose resume window is over
 * is scored with what exists. Runs where interviews are read (the status
 * poll, the analysis page, the lists), next to the expiry sweep. Returns
 * the ids made final, so a caller can start their feedback.
 */
export async function finalizeLapsedInterviews(userId: string, now = new Date()): Promise<string[]> {
  try {
    const due = await prisma.interview.findMany({
      where: { userId, status: "IN_PROGRESS", resumableUntil: { lte: now } },
      select: { id: true, transcriptSource: true, lastSessionAt: true },
    });
    const finalized: string[] = [];
    for (const row of due) {
      // A latest call still waiting for its record is the reconcile's to fetch, until it is long overdue.
      const overdue = !row.transcriptSource && row.lastSessionAt !== null && now.getTime() - row.lastSessionAt.getTime() > UNRECORDED_CALL_GIVE_UP_MS;
      if (!row.transcriptSource && !overdue) continue;
      if ((await finalizeResumableInterview(row.id, { latestMissing: overdue })) === "finalized") finalized.push(row.id);
    }
    return finalized;
  } catch (error) {
    handleError(error, `Failed to finalize lapsed interviews (user=${userId})`);
  }
}

/**
 * The room's account of how the call ended, on top of the end time: a drop
 * opens the resume window (once); a request to finish is recorded and, when
 * the latest call is already stored, applied at once. Owner-scoped by the
 * `userId` the route resolved.
 */
export async function recordCallOutcome({
  interviewId,
  userId,
  outcome,
  now = new Date(),
}: {
  interviewId: string;
  userId: string;
  outcome: "finish" | "drop";
  now?: Date;
}): Promise<{ finalized: boolean }> {
  try {
    if (outcome === "drop") {
      await prisma.interview.updateMany({
        where: { id: interviewId, userId, status: "IN_PROGRESS", resumableUntil: null, finishRequestedAt: null },
        data: { resumableUntil: new Date(now.getTime() + RESUME_WINDOW_MS) },
      });
      return { finalized: false };
    }
    const marked = await prisma.interview.updateMany({ where: { id: interviewId, userId, status: "IN_PROGRESS" }, data: { finishRequestedAt: now } });
    if (marked.count !== 1) return { finalized: false };
    return { finalized: (await finalizeResumableInterview(interviewId)) === "finalized" };
  } catch (error) {
    handleError(error, "Failed to record how the call ended");
  }
}

/** Whether a stored transcript of the row has the candidate speaking; for the session endpoint's carry-over. */
export function storedCallCounts(transcript: unknown): boolean {
  const turns = turnsSchema.safeParse(transcript);
  return turns.success && hasCandidateTurns(turns.data);
}
