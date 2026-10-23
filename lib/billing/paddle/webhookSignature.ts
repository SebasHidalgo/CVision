import { createHmac } from "node:crypto";

/**
 * The `Paddle-Signature` header for a payload: `ts=<unix seconds>;h1=<hex
 * HMAC-SHA256 of "<ts>:<raw body>">` with the notification destination's
 * secret as the key. Verification goes through the SDK
 * (`lib/billing/paddle/webhook.ts`); this is the other half, for tests and
 * for sending a signed event at a running server by hand.
 */
export function signPaddleWebhook(
  rawBody: string,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}:${rawBody}`).digest("hex");
  return `ts=${timestampSeconds};h1=${digest}`;
}
