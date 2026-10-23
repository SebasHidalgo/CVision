import { createHmac, timingSafeEqual } from "node:crypto";
import { readPaddleConfig } from "./client";

/**
 * The user id the server attaches to a transaction's custom data, signed.
 * Paddle copies a transaction's custom data to the subscription it creates
 * and echoes it in every event, which is how the first event of a new
 * customer finds its user. But Paddle.js lets the browser pass custom data
 * when it opens a checkout, so a bare id could be rewritten from the
 * console to attribute a purchase to someone else. The signature, keyed by
 * the server's API key, makes a rewritten id a missing one.
 */

const USER_ID_KEY = "userId";
const SIGNATURE_KEY = "sig";

export function signUserId(userId: string, key: string): string {
  return createHmac("sha256", key).update(`cvision-user:${userId}`).digest("hex");
}

/** The custom data to put on a transaction for this user. */
export function customDataFor(userId: string): Record<string, string> {
  const { apiKey } = readPaddleConfig();
  return { [USER_ID_KEY]: userId, [SIGNATURE_KEY]: signUserId(userId, apiKey) };
}

/** The user id a provider object names, when its signature holds; null otherwise. */
export function userIdFromCustomData(customData: Record<string, unknown> | null | undefined): string | null {
  const userId = customData?.[USER_ID_KEY];
  const signature = customData?.[SIGNATURE_KEY];
  if (typeof userId !== "string" || userId === "" || typeof signature !== "string") return null;

  const { apiKey } = readPaddleConfig();
  const expected = Buffer.from(signUserId(userId, apiKey), "hex");
  const given = Buffer.from(signature, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return userId;
}
