import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
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
 * Profile details for server code that cannot redirect (Route Handlers).
 * Costs a Clerk API call, unlike `requireUserId`, which reads the session.
 */
export async function getUserProfile(): Promise<{ firstName: string | null }> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return { firstName: user.firstName };
}
