/**
 * Deletes every test account the browser suite created and did not get to
 * delete (a run that died, a Ctrl-C): the accounts whose address starts
 * with `e2e-` and carries `+clerk_test`, on the Clerk development instance.
 * Each is deleted at Clerk, which fires the app's `user.deleted` webhook
 * through the tunnel, and cascaded here as well, so the rows go even when
 * the tunnel is down.
 *
 *   npm run e2e:cleanup              delete them
 *   npm run e2e:cleanup -- --dry-run list them
 *
 * Refuses anything but a development instance.
 */
import { parseArgs } from "node:util";
import { deleteAccountCascade } from "@/lib/deletion";
import { assertSandbox } from "./support/env";
import { deleteAccount, listTestAccounts } from "./support/accounts";

const { values: args } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

async function main() {
  assertSandbox();
  const accounts = await listTestAccounts();
  console.log(`${accounts.length} test account(s) on the instance`);
  for (const account of accounts) {
    if (args["dry-run"]) {
      console.log(`  would delete ${account.email} (${account.id})`);
      continue;
    }
    const outcome = await deleteAccount(account);
    const summary = await deleteAccountCascade(account.id);
    console.log(`  ${account.email}: clerk ${outcome}; rows: analyses=${summary.analyses} user=${summary.userRowRemoved ? "removed" : "already gone"} subscriptionsCanceled=${summary.subscriptionsCanceled}`);
  }
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`e2e:cleanup failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exit(1);
  });
}
