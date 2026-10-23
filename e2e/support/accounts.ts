import { createClerkClient, type User } from "@clerk/backend";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";
import { required } from "./env";

/**
 * Test accounts on the Clerk development instance. Created through the
 * Backend API with a `+clerk_test` address (no email is ever sent, the
 * code is always 424242), signed in through a sign-in token the Backend
 * API mints (the sign-up form, and so bot sign-up protection, is never
 * touched; it stays on), and deleted the same way, which fires the app's
 * `user.deleted` webhook through the tunnel and cascades every row. A run
 * that dies leaves accounts behind only until `npm run e2e:cleanup`.
 */

export const TEST_EMAIL_TAG = "+clerk_test";
export const TEST_EMAIL_PREFIX = "e2e-";
export const TEST_EMAIL_DOMAIN = "example.com";

export type TestAccount = { id: string; email: string };

const backend = () => createClerkClient({ secretKey: required("CLERK_SECRET_KEY") });

export function testEmail(label: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 7);
  return `${TEST_EMAIL_PREFIX}${label}-${stamp}-${nonce}${TEST_EMAIL_TAG}@${TEST_EMAIL_DOMAIN}`;
}

export function isTestAccount(user: Pick<User, "emailAddresses">): boolean {
  return user.emailAddresses.some((email) => email.emailAddress.startsWith(TEST_EMAIL_PREFIX) && email.emailAddress.includes(TEST_EMAIL_TAG));
}

export async function createAccount(label: string): Promise<TestAccount> {
  const email = testEmail(label);
  const user = await backend().users.createUser({
    emailAddress: [email],
    firstName: "E2E",
    lastName: label,
    skipPasswordRequirement: true,
  });
  return { id: user.id, email };
}

/** Deletes the account at Clerk; the app's webhook removes its rows, its CV and its conversations. Tolerates one already gone. */
export async function deleteAccount(account: Pick<TestAccount, "id">): Promise<"deleted" | "already-gone"> {
  try {
    await backend().users.deleteUser(account.id);
    return "deleted";
  } catch (error) {
    if ((error as { status?: number })?.status === 404) return "already-gone";
    throw error;
  }
}

/** Every test account on the instance, for the cleanup command. */
export async function listTestAccounts(): Promise<TestAccount[]> {
  const found: TestAccount[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await backend().users.getUserList({ limit: 100, offset, query: TEST_EMAIL_TAG });
    for (const user of page.data) {
      if (isTestAccount(user)) found.push({ id: user.id, email: user.emailAddresses[0]?.emailAddress ?? "" });
    }
    if (page.data.length < 100) return found;
  }
}

let clerkReady: Promise<void> | null = null;

/** The Testing Token for this worker, fetched once; what lets the browser's Clerk calls bypass bot detection. */
export function ensureClerkTesting(): Promise<void> {
  clerkReady ??= clerkSetup({ dotenv: false });
  return clerkReady;
}

/** Signs the page in as the account, from a public page, through a sign-in token: no form, no code, no bot check. */
export async function signIn(page: Page, account: TestAccount): Promise<void> {
  await ensureClerkTesting();
  await setupClerkTestingToken({ page });
  await page.goto("/pricing");
  await clerk.signIn({ page, emailAddress: account.email });
}
