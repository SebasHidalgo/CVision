import { createHmac } from "node:crypto";

/**
 * The `ElevenLabs-Signature` header value for a payload: `t=<unix seconds>,
 * v0=<hex HMAC-SHA256 of "<t>.<raw body>">`. Verification goes through the
 * SDK (`lib/elevenlabs/client.ts`); this is the other half, for tests and for
 * sending a signed event at a running server by hand.
 */
export function signWebhookPayload(
  rawBody: string,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest("hex");
  return `t=${timestampSeconds},v0=${digest}`;
}
