import { randomUUID } from "node:crypto";
import type { SubscriptionStatus } from "@prisma/client";
import { db } from "./db";
import type { TestAccount } from "./accounts";

/**
 * A plan state written straight to the database, for pages that read it: a mirrored subscription and its billing
 * customer, never heard of by the provider. Every period lies in the future, so no lazy reconcile asks the provider
 * about them; `clearBilling` removes them before the account is deleted, so the deletion cancels nothing there.
 */

const DAY_MS = 86_400_000;

export type SeededSubscriptionState = "active" | "pastDue" | "canceling" | "paused" | "canceled";

const STATUS: Record<SeededSubscriptionState, SubscriptionStatus> = {
  active: "ACTIVE",
  pastDue: "PAST_DUE",
  canceling: "ACTIVE",
  paused: "PAUSED",
  canceled: "CANCELED",
};

/** Midnight UTC, `days` from today: the dates the page prints are the same whatever the hour. */
const daysFromToday = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
};

export async function clearBilling(account: Pick<TestAccount, "id">): Promise<void> {
  await db.subscription.deleteMany({ where: { userId: account.id } });
  await db.billingCustomer.deleteMany({ where: { userId: account.id } });
}

/** The account with one subscription in `state` and a billing customer; returns the dates the page should show. */
export async function seedSubscription(account: Pick<TestAccount, "id">, state: SeededSubscriptionState): Promise<{ periodEnd: Date }> {
  await clearBilling(account);
  // Clerk's user.created webhook may insert the same row at this moment: ON CONFLICT, not an upsert.
  await db.user.createMany({ data: [{ id: account.id }], skipDuplicates: true });
  await db.billingCustomer.create({ data: { userId: account.id, providerCustomerId: `ctm_e2e_${randomUUID()}` } });

  const live = state !== "paused" && state !== "canceled";
  const periodEnd = daysFromToday(20);
  await db.subscription.create({
    data: {
      userId: account.id,
      providerSubscriptionId: `sub_e2e_${randomUUID()}`,
      status: STATUS[state],
      priceKey: "pro_monthly",
      currentPeriodStart: live ? new Date(periodEnd.getTime() - 30 * DAY_MS) : null,
      currentPeriodEnd: live ? periodEnd : null,
      cancelAtPeriodEnd: state === "canceling",
      scheduledChangeAt: state === "canceling" ? periodEnd : null,
      canceledAt: state === "canceled" ? daysFromToday(-2) : null,
      providerUpdatedAt: new Date(),
    },
  });
  return { periodEnd };
}
