import "server-only";

import prisma from "@/lib/prisma";
import { handleError } from "@/lib/error/handleError";
import { INTERVIEW_ABANDON_MS } from "@/lib/interviewLimits";
import { refundUsage } from "./usage";

/**
 * Expiry of abandoned interviews, done lazily where interviews and quotas
 * are read (the usage summary behind every CTA and page, the status poll,
 * the session endpoint) instead of by a cron. No session: the callers pass
 * the id they resolved, and every query is scoped by it.
 *
 * Imports `refundUsage` from the ledger, which in turn calls this from its
 * summary: a cycle of two call-time bindings, deliberate, so one read of a
 * quota is also the sweep.
 */

/** `failureReason` and refund reason of an interview nobody came back to. */
export const ABANDONED = "ABANDONED";

/**
 * An IN_PROGRESS interview whose latest session is older than
 * INTERVIEW_ABANDON_MS never connected, never produced an answer, or lost
 * its transcript for good, and nobody is coming back to it: a trial whose
 * tab was closed on the microphone prompt, a Pro reservation the same way,
 * or one with its three starts used up and no transcript, waiting on a
 * platform reconcile that will never say more (the calls end at twelve
 * minutes and their webhook arrives within one; two hours is far past
 * both). It becomes EXPIRED and the unit its first token took goes back.
 * One guarded update per row, so a session issued in between (the user
 * did come back) wins. Returns how many expired.
 */
export async function expireAbandonedInterviews(userId: string, now = new Date()): Promise<number> {
  try {
    const cutoff = new Date(now.getTime() - INTERVIEW_ABANDON_MS);
    const candidates = await prisma.interview.findMany({
      where: {
        userId,
        status: "IN_PROGRESS",
        lastSessionAt: { lt: cutoff },
      },
      select: { id: true, usageEventId: true },
    });

    let expired = 0;
    for (const row of candidates) {
      const result = await prisma.interview.updateMany({
        where: { id: row.id, userId, status: "IN_PROGRESS", lastSessionAt: { lt: cutoff } },
        data: { status: "EXPIRED", failureReason: ABANDONED },
      });
      if (result.count !== 1) continue;
      expired += 1;

      const refunded = row.usageEventId ? await refundUsage(row.usageEventId, ABANDONED) : false;
      console.info(
        `[CVision][expiry] interview=${row.id} user=${userId} expired after ${INTERVIEW_ABANDON_MS / 3_600_000} h without a session; unit ${refunded ? "refunded" : row.usageEventId ? "already refunded" : "none"}`,
      );
    }
    return expired;
  } catch (error) {
    handleError(error, `Failed to expire abandoned interviews (user=${userId})`);
  }
}
