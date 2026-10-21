import "server-only";

import { Prisma, type SubscriptionStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { standingFrom, type PlanStanding, type SubscriptionStanding } from "@/lib/billing/access";
import type { ProviderSubscription } from "@/lib/billing/types";
import { handleError } from "@/lib/error/handleError";

/**
 * Data access for billing: the user-to-customer mapping, the mirror of the
 * provider's subscriptions, the event trail, and the plan derived from
 * them. No session: the callers are the webhook route (which authenticated
 * the delivery by its signature), the actions (which resolved the session
 * and pass their own id), the ledger and the reconcile. Every write is
 * scoped by the ids it was given; nothing here decides what a plan allows.
 */

const UNIQUE_VIOLATION = "P2002";

const standingSelect = {
  id: true,
  providerSubscriptionId: true,
  status: true,
  priceKey: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  scheduledChangeAt: true,
  canceledAt: true,
  providerUpdatedAt: true,
} satisfies Prisma.SubscriptionSelect;

export async function findBillingCustomer(userId: string): Promise<{ providerCustomerId: string } | null> {
  try {
    return await prisma.billingCustomer.findUnique({ where: { userId }, select: { providerCustomerId: true } });
  } catch (error) {
    handleError(error, `Failed to read the billing customer (user=${userId})`);
  }
}

export async function findUserIdByProviderCustomer(providerCustomerId: string): Promise<string | null> {
  try {
    const row = await prisma.billingCustomer.findUnique({ where: { providerCustomerId }, select: { userId: true } });
    return row?.userId ?? null;
  } catch (error) {
    handleError(error, `Failed to look up the billing customer (customer=${providerCustomerId})`);
  }
}

export type LinkOutcome =
  | "linked"
  /** The same pair already existed. */
  | "already"
  /** The customer is another user's, or the user already has another customer: left as it was, logged. */
  | "conflict";

/**
 * Records that a provider customer is this user's, from the first event
 * that names both. One customer per user and one user per customer; a
 * pair that contradicts an existing one is refused and logged, never
 * remapped, because remapping would move a subscription between accounts.
 */
export async function linkBillingCustomer(userId: string, providerCustomerId: string): Promise<LinkOutcome> {
  try {
    await prisma.billingCustomer.create({ data: { userId, providerCustomerId } });
    return "linked";
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION)) {
      handleError(error, `Failed to link the billing customer (user=${userId}, customer=${providerCustomerId})`);
    }
    const existing = await prisma.billingCustomer.findUnique({ where: { userId }, select: { providerCustomerId: true } });
    if (existing?.providerCustomerId === providerCustomerId) return "already";
    console.error(
      `[CVision][billing] customer link conflict: user=${userId} customer=${providerCustomerId} (user has ${existing?.providerCustomerId ?? "none"}; the customer may belong to another user)`,
    );
    return "conflict";
  }
}

export async function listSubscriptionRows(userId: string): Promise<SubscriptionStanding[]> {
  try {
    return await prisma.subscription.findMany({ where: { userId }, select: standingSelect });
  } catch (error) {
    handleError(error, `Failed to list the subscriptions (user=${userId})`);
  }
}

export type SnapshotOutcome = "created" | "applied" | "stale";

/**
 * Mirrors one provider subscription for the user. Events arrive out of
 * order and repeat, so an existing row changes only when the snapshot's
 * `providerUpdatedAt` is newer than the row's; the same instant is a
 * repeat. The row's user never changes: ownership was decided by the first
 * event and a later one cannot move the subscription.
 */
export async function applySubscriptionSnapshot(userId: string, snapshot: ProviderSubscription): Promise<SnapshotOutcome> {
  const data = {
    status: toStatus(snapshot.status),
    priceKey: snapshot.priceKey ?? "unknown",
    currentPeriodStart: snapshot.currentPeriodStart,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    scheduledChangeAt: snapshot.scheduledChangeAt,
    canceledAt: snapshot.canceledAt,
    providerUpdatedAt: snapshot.providerUpdatedAt,
  };
  try {
    await prisma.subscription.create({
      data: { userId, providerSubscriptionId: snapshot.providerSubscriptionId, ...data },
    });
    return "created";
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION)) {
      handleError(error, `Failed to mirror the subscription (user=${userId}, subscription=${snapshot.providerSubscriptionId})`);
    }
  }
  try {
    const updated = await prisma.subscription.updateMany({
      where: {
        providerSubscriptionId: snapshot.providerSubscriptionId,
        providerUpdatedAt: { lt: snapshot.providerUpdatedAt },
      },
      data,
    });
    return updated.count === 1 ? "applied" : "stale";
  } catch (error) {
    handleError(error, `Failed to mirror the subscription (user=${userId}, subscription=${snapshot.providerSubscriptionId})`);
  }
}

/** The user of a mirrored subscription, for events that name only the subscription. */
export async function findUserIdByProviderSubscription(providerSubscriptionId: string): Promise<string | null> {
  try {
    const row = await prisma.subscription.findUnique({ where: { providerSubscriptionId }, select: { userId: true } });
    return row?.userId ?? null;
  } catch (error) {
    handleError(error, `Failed to look up the subscription (subscription=${providerSubscriptionId})`);
  }
}

/** The plan in force for the user, derived from the comp and the mirrored subscriptions. */
export async function resolvePlanStanding(userId: string, now = new Date()): Promise<PlanStanding> {
  try {
    const [user, subscriptions] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { compPlan: true } }),
      prisma.subscription.findMany({ where: { userId }, select: standingSelect }),
    ]);
    return standingFrom({ compPlan: user?.compPlan ?? null, subscriptions }, now);
  } catch (error) {
    handleError(error, `Failed to resolve the plan (user=${userId})`);
  }
}

/** The same derivation inside a caller's transaction, for the ledger's serializable reservation. */
export async function resolvePlanStandingIn(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<PlanStanding> {
  const [user, subscriptions] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { compPlan: true } }),
    tx.subscription.findMany({ where: { userId }, select: standingSelect }),
  ]);
  return standingFrom({ compPlan: user?.compPlan ?? null, subscriptions }, now);
}

/** A claim older than this with no outcome is a handler that died; the event may be taken again. */
export const BILLING_EVENT_CLAIM_STALE_MS = 2 * 60_000;

export type ClaimOutcome = "claimed" | "duplicate";

/**
 * Takes the right to apply one provider event. The first delivery inserts
 * the row and wins; a repeat finds it and loses, unless the earlier
 * handler never finished and its claim is stale. Releasing a claim after
 * a failure lets the provider's retry take it again at once.
 */
export async function claimBillingEvent(
  event: { eventId: string; type: string; occurredAt: Date },
  now = new Date(),
): Promise<ClaimOutcome> {
  try {
    await prisma.billingEvent.create({
      data: { providerEventId: event.eventId, type: event.type, occurredAt: event.occurredAt, claimedAt: now },
    });
    return "claimed";
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION)) {
      handleError(error, `Failed to record the billing event (event=${event.eventId})`);
    }
  }
  try {
    const taken = await prisma.billingEvent.updateMany({
      where: {
        providerEventId: event.eventId,
        processedAt: null,
        OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - BILLING_EVENT_CLAIM_STALE_MS) } }],
      },
      data: { claimedAt: now },
    });
    return taken.count === 1 ? "claimed" : "duplicate";
  } catch (error) {
    handleError(error, `Failed to claim the billing event (event=${event.eventId})`);
  }
}

export async function markBillingEventProcessed(eventId: string, userId: string | null, now = new Date()): Promise<void> {
  try {
    await prisma.billingEvent.updateMany({ where: { providerEventId: eventId }, data: { processedAt: now, userId } });
  } catch (error) {
    handleError(error, `Failed to mark the billing event processed (event=${eventId})`);
  }
}

/** The handler failed: the provider's retry may claim the event again right away. */
export async function releaseBillingEvent(eventId: string): Promise<void> {
  try {
    await prisma.billingEvent.updateMany({ where: { providerEventId: eventId, processedAt: null }, data: { claimedAt: null } });
  } catch (error) {
    handleError(error, `Failed to release the billing event (event=${eventId})`);
  }
}

function toStatus(status: ProviderSubscription["status"]): SubscriptionStatus {
  return status.toUpperCase() as SubscriptionStatus;
}
