import "server-only";

import type { GuardKind, Prisma } from "@prisma/client";
import { GUARD_ROWS, type GuardStats } from "@/lib/ai/schemas";

/**
 * The anonymous daily aggregate of the guardrails (`GuardStatDaily`). The
 * per-row `guardStats` is deleted with its analysis or account; this is
 * incremented in the same transaction and never deleted, so the production
 * quality signal does not vanish user by user. Nothing here names a user.
 */

export type GuardStatIncrement = { check: string; action: string; count: number };

/**
 * What one stored `guardStats` adds to its day: one increment per
 * (check, action) pair among its interventions, one row recorded, and one
 * row fired when anything did.
 */
export function guardStatIncrements(stats: GuardStats): GuardStatIncrement[] {
  const pairs = new Map<string, GuardStatIncrement>();
  for (const intervention of stats.interventions) {
    const key = `${intervention.check}\u0000${intervention.action}`;
    const current = pairs.get(key);
    if (current) current.count += 1;
    else pairs.set(key, { check: intervention.check, action: intervention.action, count: 1 });
  }

  const fired =
    stats.interventions.length > 0 || Object.values(stats.counts).some((count) => count > 0);

  return [
    ...pairs.values(),
    { check: GUARD_ROWS.check, action: GUARD_ROWS.recorded, count: 1 },
    ...(fired ? [{ check: GUARD_ROWS.check, action: GUARD_ROWS.fired, count: 1 }] : []),
  ];
}

/** The UTC day a timestamp falls on, as the `date` column holds it. */
export function guardStatDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * Adds one stored `guardStats` to the day's tallies, inside the caller's
 * transaction so the row and its aggregate land or fail together. Each
 * upsert is a single conflict-safe statement, so two rows stored at once
 * both count.
 */
export async function recordGuardStatsDaily(
  tx: Prisma.TransactionClient,
  kind: GuardKind,
  at: Date,
  stats: GuardStats,
): Promise<void> {
  const date = guardStatDay(at);
  for (const { check, action, count } of guardStatIncrements(stats)) {
    await tx.guardStatDaily.upsert({
      where: { date_kind_check_action: { date, kind, check, action } },
      create: { date, kind, check, action, count },
      update: { count: { increment: count } },
    });
  }
}
