/**
 * Sets an account's plan by hand, until billing (M6) does it.
 *
 *   npm run user:set-plan -- <clerkUserId> <free|pro>
 *
 * Prints the plan before and after. The user row must exist (it does for
 * any account that has run an analysis or signed up with the webhook on).
 */
import { PrismaClient, type Plan } from "@prisma/client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL });

async function main() {
  const [userId, planArg] = process.argv.slice(2);
  const plan = planArg?.toUpperCase();
  if (!userId || (plan !== "FREE" && plan !== "PRO")) {
    throw new Error("usage: npm run user:set-plan -- <clerkUserId> <free|pro>");
  }

  const before = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (!before) throw new Error(`no User row for ${userId}`);
  console.log(`before: ${userId} plan=${before.plan}`);

  const after = await prisma.user.update({ where: { id: userId }, data: { plan: plan as Plan }, select: { plan: true } });
  console.log(`after:  ${userId} plan=${after.plan}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
