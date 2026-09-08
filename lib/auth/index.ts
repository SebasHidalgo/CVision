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
