import "server-only";

import { Prisma, type GuardKind } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { recordGuardIncrements, type GuardStatIncrement } from "@/lib/database/guardStats";
import { handleError } from "@/lib/error/handleError";

/**
 * Stored translations of an analysis' or an interview feedback's prose. The caller resolves the
 * session and passes the user id (an action, or `after()` right behind one): every read and write
 * goes through the parent's owner in the `where`, so an id of someone else's item matches nothing.
 */

/** Which item a translation belongs to. */
export type TranslationParent = { analysisId: string } | { interviewFeedbackId: string };

/** A PENDING claim older than this is abandoned (its request died) and may be taken over. */
export const TRANSLATION_CLAIM_STALE_MS = 60_000;
/** A failed translation is retried on a view this long after the failure, not before. */
export const TRANSLATION_RETRY_AFTER_MS = 10 * 60_000;

export type TranslationRow = Prisma.ContentTranslationGetPayload<object>;

const ownedBy = (parent: TranslationParent, userId: string): Prisma.ContentTranslationWhereInput =>
  "analysisId" in parent
    ? { analysisId: parent.analysisId, analysis: { userId } }
    : { interviewFeedbackId: parent.interviewFeedbackId, interviewFeedback: { interview: { userId } } };

export async function readTranslation(userId: string, parent: TranslationParent, locale: string): Promise<TranslationRow | null> {
  try {
    return await prisma.contentTranslation.findFirst({ where: { ...ownedBy(parent, userId), locale } });
  } catch (error) {
    handleError(error, "Failed to read a translation");
  }
}

/** For pages: the caller's own translation of an item, identity from the session. */
export async function readOwnTranslation(parent: TranslationParent, locale: string): Promise<TranslationRow | null> {
  return readTranslation(await requireUserId(), parent, locale);
}

export type Claim =
  | { kind: "claimed"; row: TranslationRow }
  | { kind: "ready"; row: TranslationRow }
  | { kind: "busy" }
  | { kind: "failed"; row: TranslationRow }
  | { kind: "missing" };

/**
 * One call per item and language: the first request inserts the PENDING row and translates; the
 * others see it and wait. A stale claim, a failure old enough to retry, or a row that no longer
 * matches its source is taken over with a conditional update, so two takers cannot both win.
 */
export async function claimTranslation(userId: string, parent: TranslationParent, locale: string, sourceHash: string, now = new Date()): Promise<Claim> {
  try {
    const owned = await (("analysisId" in parent)
      ? prisma.resumeAnalysis.count({ where: { id: parent.analysisId, userId } })
      : prisma.interviewFeedback.count({ where: { id: parent.interviewFeedbackId, interview: { userId } } }));
    if (owned === 0) return { kind: "missing" };
    try {
      const row = await prisma.contentTranslation.create({ data: { ...parent, locale, sourceHash, status: "PENDING", attempts: 1, claimedAt: now } });
      return { kind: "claimed", row };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
    const row = await prisma.contentTranslation.findFirst({ where: { ...ownedBy(parent, userId), locale } });
    if (!row) return { kind: "busy" };
    const current = row.sourceHash === sourceHash;
    if (current && row.status === "READY") return { kind: "ready", row };
    if (current && row.status === "PENDING" && now.getTime() - row.claimedAt.getTime() < TRANSLATION_CLAIM_STALE_MS) return { kind: "busy" };
    if (current && row.status === "FAILED" && row.failedAt && now.getTime() - row.failedAt.getTime() < TRANSLATION_RETRY_AFTER_MS) return { kind: "failed", row };
    const taken = await prisma.contentTranslation.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { status: "PENDING", sourceHash, claimedAt: now, attempts: { increment: 1 }, failedAt: null },
    });
    if (taken.count === 0) return { kind: "busy" };
    return { kind: "claimed", row: { ...row, status: "PENDING", sourceHash, claimedAt: now } };
  } catch (error) {
    handleError(error, "Failed to claim a translation");
  }
}

export async function completeTranslation(
  id: string,
  claimedAt: Date,
  data: { payload: Prisma.InputJsonValue; guardStats: Prisma.InputJsonValue; model: string; modelVersion: string | null },
  daily?: { kind: GuardKind; increments: GuardStatIncrement[] },
  now = new Date(),
): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Only the claim that is still current writes: a taken-over claim's late answer is dropped.
      const written = await tx.contentTranslation.updateMany({ where: { id, status: "PENDING", claimedAt }, data: { ...data, status: "READY" } });
      if (written.count === 1 && daily) await recordGuardIncrements(tx, daily.kind, now, daily.increments);
      return written.count === 1;
    });
  } catch (error) {
    handleError(error, "Failed to store a translation");
  }
}

export async function failTranslation(id: string, claimedAt: Date, now = new Date()): Promise<void> {
  try {
    await prisma.contentTranslation.updateMany({ where: { id, status: "PENDING", claimedAt }, data: { status: "FAILED", failedAt: now } });
  } catch (error) {
    handleError(error, "Failed to record a failed translation");
  }
}
