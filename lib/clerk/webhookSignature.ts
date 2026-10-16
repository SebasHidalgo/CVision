import { createHmac } from "node:crypto";

/**
 * Signs a payload the way Clerk (Svix, the Standard Webhooks format) does,
 * for tests and local checks of the webhook route: three headers, the
 * signature an HMAC-SHA256 of `${id}.${timestamp}.${payload}` with the
 * secret's base64 part as the key. Verification itself is the SDK's.
 */
export function signClerkWebhook(
  payload: string,
  secret: string,
  options: { id?: string; timestampSeconds?: number } = {},
): Record<string, string> {
  const id = options.id ?? "msg_test";
  const timestamp = String(options.timestampSeconds ?? Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}
