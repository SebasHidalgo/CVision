/**
 * Grants or removes a manual Pro, outside billing: the owner's own account,
 * a comped tester. The plan a user has is derived (a subscription that
 * grants access, else this comp, else Free), so this never overrides a
 * paid subscription and never cancels one.
 *
 *   npm run user:set-plan -- <clerkUserId> pro     sets User.compPlan = PRO
 *   npm run user:set-plan -- <clerkUserId> free    clears it
 *
 * Prints the comp before and after, and the subscriptions the account has,
 * so a "free" on a paying account is visibly a no-op. The user row must
 * exist (it does for any account that ran an analysis or signed up with
 * the webhook on).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL });

async function main() {
  const [userId, planArg] = process.argv.slice(2);
  const plan = planArg?.toUpperCase();
  if (!userId || (plan !== "FREE" && plan !== "PRO")) {
    throw new Error("usage: npm run user:set-plan -- <clerkUserId> <free|pro>");
  }

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { compPlan: true, subscriptions: { select: { providerSubscriptionId: true, status: true, currentPeriodEnd: true } } },
  });
  if (!before) throw new Error(`no User row for ${userId}`);
  console.log(`before: ${userId} compPlan=${before.compPlan ?? "none"}`);
  for (const subscription of before.subscriptions) {
    console.log(
      `        subscription ${subscription.providerSubscriptionId} ${subscription.status}${subscription.currentPeriodEnd ? ` until ${subscription.currentPeriodEnd.toISOString()}` : ""}`,
    );
  }

  const after = await prisma.user.update({
    where: { id: userId },
    data: { compPlan: plan === "PRO" ? "PRO" : null },
    select: { compPlan: true },
  });
  console.log(`after:  ${userId} compPlan=${after.compPlan ?? "none"}`);
  if (plan === "FREE" && before.subscriptions.some((s) => s.status !== "CANCELED")) {
    console.log("note: the account still has a subscription; its plan comes from that, not from the comp.");
  }
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
