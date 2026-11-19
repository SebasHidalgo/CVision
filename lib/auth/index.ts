import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect, unstable_rethrow } from "next/navigation";
import { UnauthorizedError } from "@/lib/error/errors";

/** Server Components only: redirects home when there is no session. */
export const getAuthUser = async () => {
  const user = await currentUser();
  if (!user) {
    redirect("/");
  }
  return user;
};

/**
 * Identity for the data layer and Server Actions, and the only valid source of
 * `userId`. Throws instead of redirecting, since a redirect there would be a
 * hidden navigation side effect.
 */
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();
  return userId;
}

/**
 * The session's user id, or null: for the public pages that render
 * differently to a visitor and a member (the pricing page), where neither a
 * redirect nor a throw is wanted. Reads the session; no API call.
 */
export async function getOptionalUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/**
 * getOptionalUserId for what may render without Clerk's middleware: the proxy skips static-file paths, so a missing
 * /x.png renders the 404 with no session to read. There a visitor is anonymous instead of a 500.
 */
export async function getOptionalUserIdOutsideProxy(): Promise<string | null> {
  try {
    return await getOptionalUserId();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/**
 * Every email address on the account with its verification, for the free trial's claim (lib/trialIdentity.ts).
 * The same Backend API read as `currentUser()`, keyed by the id the caller resolved from its session, so the
 * ledger keeps its explicit-id contract. Throws when Clerk cannot answer.
 */
export async function accountEmailAddresses(userId: string): Promise<{ emailAddress: string; verification: { status: string } | null }[]> {
  const user = await (await clerkClient()).users.getUser(userId);
  return user.emailAddresses.map((email) => ({ emailAddress: email.emailAddress, verification: email.verification ? { status: email.verification.status } : null }));
}

/**
 * Profile details for server code that cannot redirect (Route Handlers).
 * Costs a Clerk API call, unlike `requireUserId`, which reads the session.
 */
export async function getUserProfile(): Promise<{ firstName: string | null }> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return { firstName: user.firstName };
}
