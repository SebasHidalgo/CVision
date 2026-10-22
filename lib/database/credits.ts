import "server-only";

import { Prisma, type UsageKind } from "@prisma/client";
import prisma from "@/lib/prisma";
import { handleError } from "@/lib/error/handleError";

/**
 * The pack credits in the usage ledger: the balance and the grant. No
 * session and no `lib/auth` import, on purpose: the callers are the webhook
 * (a grant per completed pack transaction), the billing reconcile (the same
 * grant for a transaction whose event never arrived) and the ledger's
 * interview reservation. The reconcile also runs from `npm run
 * billing:reconcile`, whose import graph may not reach `lib/auth` (see
 * scripts/scripts.test.ts), which is why these live apart from usage.ts.
 * The revoke, which the webhook alone calls, stays in usage.ts beside the
 * serializable transaction it needs.
 */

const UNIQUE_VIOLATION = "P2002";
const FOREIGN_KEY_VIOLATION = "P2003";

/**
 * One query: the units of every grant and revoke, and of every consumption
 * not given back (a consumption is one unit), grouped by kind. Every round
 * trip to the pooler costs hundreds of milliseconds from far away, and this
 * runs inside the interview reservation and on every status poll.
 */
export async function creditBalanceIn(db: Prisma.TransactionClient, userId: string): Promise<number> {
  const rows = await db.usageEvent.groupBy({
    by: ["kind"],
    where: {
      userId,
      OR: [{ kind: { in: ["INTERVIEW_CREDIT_GRANT", "INTERVIEW_CREDIT_REVOKE"] } }, { kind: "INTERVIEW_CREDIT", refundedAt: null }],
    },
    _sum: { units: true },
  });
  const units = (kind: UsageKind) => rows.find((row) => row.kind === kind)?._sum.units ?? 0;
  return Math.max(0, units("INTERVIEW_CREDIT_GRANT") - units("INTERVIEW_CREDIT_REVOKE") - units("INTERVIEW_CREDIT"));
}

/** How many pack credits the user holds: grants minus revokes minus the non-refunded consumption. */
export async function interviewCreditBalance(userId: string): Promise<number> {
  try {
    return await creditBalanceIn(prisma, userId);
  } catch (error) {
    handleError(error, `Failed to read the credit balance (user=${userId})`);
  }
}

export type GrantOutcome =
  | { granted: true }
  /** The transaction was granted before: a replayed event, or a reconcile of one that arrived. */
  | { granted: false; reason: "already" }
  /** The account no longer exists (its row went between the lookup and the write): nothing to credit. */
  | { granted: false; reason: "no-user" };

/**
 * Credits a pack purchase to the user, once: the transaction id is the
 * grant's `refId`, unique per kind, so a replayed event (or the reconcile
 * finding the same transaction) changes nothing. The units are the caller's
 * (the catalog's size at the time) and stay on the row.
 */
export async function grantInterviewCredits(
  userId: string,
  { units, transactionId, now = new Date() }: { units: number; transactionId: string; now?: Date },
): Promise<GrantOutcome> {
  try {
    await prisma.usageEvent.create({
      data: { userId, kind: "INTERVIEW_CREDIT_GRANT", refId: transactionId, units, createdAt: now },
    });
    return { granted: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === UNIQUE_VIOLATION) return { granted: false, reason: "already" };
      if (error.code === FOREIGN_KEY_VIOLATION) return { granted: false, reason: "no-user" };
    }
    handleError(error, `Failed to grant interview credits (user=${userId}, transaction=${transactionId})`);
  }
}
