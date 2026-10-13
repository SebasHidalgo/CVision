/**
 * Storage keys for CVs: `cv/{userId}/{uuid}.pdf`. Import-free so the schema,
 * the client and the server share one definition of what a key looks like
 * and whose it is.
 */
export const RESUME_KEY_PREFIX = "cv/";

/** The whole key: the prefix, one Clerk user id, one uuid file name. */
export const RESUME_KEY_PATTERN =
  /^cv\/[A-Za-z0-9_-]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

export function buildResumeKey(userId: string): string {
  return `${RESUME_KEY_PREFIX}${userId}/${crypto.randomUUID()}.pdf`;
}

export function isResumeKey(key: string): boolean {
  return RESUME_KEY_PATTERN.test(key);
}

/**
 * Whether a key names an object of this user. Shape and ownership together:
 * a key that is not under `cv/{userId}/` is treated as not existing, the
 * same answer a foreign row gets from the data layer.
 */
export function isResumeKeyOf(key: string, userId: string): boolean {
  return isResumeKey(key) && key.startsWith(`${RESUME_KEY_PREFIX}${userId}/`);
}
