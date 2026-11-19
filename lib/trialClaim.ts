import { createHmac } from "node:crypto";

/**
 * One free trial per email, across deleted and re-created accounts. An
 * email is normalized (so the variants a provider delivers to one inbox
 * read as one) and kept only as an HMAC-SHA256 keyed with
 * TRIAL_CLAIM_PEPPER, a server-only secret: the TrialClaim table holds no
 * address and no user id. No `server-only` import, so the e2e suite can
 * compute a claim with the server's pepper; the pepper itself is read only
 * from the server's env (lib/trialIdentity.ts). Never import this from a
 * client component.
 */

/** The shortest pepper accepted; a shorter one is treated as missing (the trial fails closed). */
export const MIN_PEPPER_CHARS = 32;

/**
 * Yahoo's disposable addresses are `base-keyword@yahoo.<tld>`, and Yahoo ids
 * cannot hold a hyphen otherwise: on these domains "-tag" is cut like "+tag".
 * Yahoo's own domains (yahoo.com, yahoo.co.uk, yahoo.com.ar, yahoo.es…) plus
 * ymail.com and rocketmail.com, which Yahoo runs. Not checked against
 * Clerk's own list, which it does not publish.
 */
const YAHOO_DOMAIN = /^(?:yahoo\.(?:[a-z]{2,3}\.)?[a-z]{2,}|ymail\.com|rocketmail\.com)$/;

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The inbox an address reaches, for the claim: lowercase and trimmed; a
 * `+tag` cut on every domain; a `-tag` cut on Yahoo's; on Gmail the dots of
 * the local part removed and googlemail.com read as gmail.com. Null for
 * anything that is not one address (no @, two @, whitespace inside, an
 * empty local part or domain, a domain without a dot or with an empty
 * label).
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.normalize("NFC").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
  const at = email.indexOf("@");
  let local = email.slice(0, at);
  let domain = email.slice(at + 1).replace(/\.$/, "");
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => label.length === 0)) return null;

  local = local.split("+")[0];
  if (YAHOO_DOMAIN.test(domain)) local = local.split("-")[0];
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return local.length > 0 ? `${local}@${domain}` : null;
}

/** The claim key of a normalized email: HMAC-SHA256 keyed with the pepper, hex. */
export function trialClaimHash(normalizedEmail: string, pepper: string): string {
  return createHmac("sha256", pepper).update(normalizedEmail, "utf8").digest("hex");
}

/** The pepper from the env, or null when missing or shorter than MIN_PEPPER_CHARS. */
export function readTrialPepper(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.TRIAL_CLAIM_PEPPER?.trim();
  return value && value.length >= MIN_PEPPER_CHARS ? value : null;
}

/** An email address as the account holds it: Clerk's `EmailAddress`, reduced to what the claim reads. */
type AccountEmail = { emailAddress: string; verification: { status: string } | null };

/** The account's verified addresses only: an unverified one proves nothing about the inbox. */
export function verifiedAddresses(emails: readonly AccountEmail[]): string[] {
  return emails.filter((email) => email.verification?.status === "verified").map((email) => email.emailAddress);
}

/** Why a trial cannot be checked against the claims: every cause fails closed (no trial offered). */
type TrialIdentityGap = "no-pepper" | "no-verified-email" | "lookup-failed";

/** What the claim check needs: one hash per distinct verified inbox, or why there are none. */
export type TrialIdentity = { kind: "emails"; hashes: string[] } | { kind: "unavailable"; cause: TrialIdentityGap };

/** The identity of an account from its verified addresses: distinct inboxes, hashed and sorted. */
export function trialIdentityOf(verified: readonly string[], pepper: string | null): TrialIdentity {
  if (!pepper) return { kind: "unavailable", cause: "no-pepper" };
  const inboxes = new Set(verified.map(normalizeEmail).filter((email): email is string => email !== null));
  const hashes = [...inboxes].map((email) => trialClaimHash(email, pepper)).sort();
  return hashes.length > 0 ? { kind: "emails", hashes } : { kind: "unavailable", cause: "no-verified-email" };
}
