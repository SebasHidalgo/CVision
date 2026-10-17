import "server-only";

import prisma from "@/lib/prisma";
import { RateLimitedError } from "@/lib/error/errors";
import { handleError } from "@/lib/error/handleError";
import { RATE_LIMITS, type RateLimitAction } from "@/lib/plans";

/**
 * Fixed-window rate limits in Postgres. One row per user, action and
 * window; the hit is one atomic upsert-increment that returns the new
 * count, so concurrent requests cannot undercount. The previous windows of
 * the same key are dropped on the way, which keeps the table at the live
 * windows without a job. No session: the caller passes the id it resolved.
 *
 * Raw SQL, parameterized by the tagged template (never concatenated):
 * Prisma's `upsert` cannot increment and return in one statement.
 */

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export async function takeRateLimit(
  userId: string,
  action: RateLimitAction,
  now = new Date(),
): Promise<RateLimitDecision> {
  try {
    const { limit, windowMs } = RATE_LIMITS[action];
    const key = `${userId}:${action}`;
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

    await prisma.$executeRaw`
      DELETE FROM "RateLimitCounter" WHERE "key" = ${key} AND "windowStart" < ${windowStart}`;

    const [row] = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitCounter" ("key", "windowStart", "count")
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT ("key", "windowStart")
      DO UPDATE SET "count" = "RateLimitCounter"."count" + 1
      RETURNING "count"`;

    if (row.count > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true, remaining: limit - row.count };
  } catch (error) {
    handleError(error, "Failed to apply the rate limit");
  }
}

/** `takeRateLimit` that throws the typed refusal, for the actions and routes. */
export async function assertRateLimit(userId: string, action: RateLimitAction, now = new Date()): Promise<void> {
  const decision = await takeRateLimit(userId, action, now);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
}
