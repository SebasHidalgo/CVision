import "server-only";

import { createHash } from "node:crypto";

/**
 * The analysis a submission names: a name-based UUID (RFC 9562 version 8, from SHA-256) of the user and the key
 * the form minted for that submission. A retry of the same submission names the same analysis, so the ledger and
 * the primary key tell it apart from a new one; the same key under another user names a different analysis.
 */
export function analysisIdFor(userId: string, submissionKey: string): string {
  const bytes = createHash("sha256").update(`cvision:analysis\n${userId}\n${submissionKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // version 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
