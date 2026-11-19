import "server-only";

import { cache } from "react";
import { accountEmailAddresses } from "@/lib/auth";
import { readTrialPepper, trialIdentityOf, verifiedAddresses, type TrialIdentity } from "@/lib/trialClaim";

/**
 * The account's trial identity: the claim hashes of its verified emails,
 * read from Clerk by id. Never throws: every gap fails closed for the trial
 * only (no trial is offered; Pro and credit starts never read this), with a
 * log line. A missing pepper is an operator error: one loud line at most
 * every 10 minutes per instance, so a misconfigured deploy is seen without
 * flooding.
 */

const LOG = "[CVision][trial]";
const PEPPER_WARN_EVERY_MS = 10 * 60_000;
// A Clerk read never holds a page longer than this; a timeout fails closed like any other failure.
const LOOKUP_TIMEOUT_MS = 5_000;
// Pages reuse an account's hashes this long (a failed lookup only briefly); the reservation always reads fresh.
const KEEP_MS = 5 * 60_000;
const KEEP_FAILED_MS = 30_000;
const KEEP_MAX = 5_000;
let pepperWarnedAt = 0;

export async function resolveTrialIdentity(userId: string, env: Record<string, string | undefined> = process.env): Promise<TrialIdentity> {
  const pepper = readTrialPepper(env);
  if (!pepper) {
    const now = Date.now();
    if (now - pepperWarnedAt >= PEPPER_WARN_EVERY_MS) {
      pepperWarnedAt = now;
      console.error(`${LOG} TRIAL_CLAIM_PEPPER IS MISSING OR SHORTER THAN 32 CHARACTERS: no free trial can start (Pro and credits are unaffected)`);
    }
    return { kind: "unavailable", cause: "no-pepper" };
  }

  let addresses: Awaited<ReturnType<typeof accountEmailAddresses>>;
  try {
    addresses = await withTimeout(accountEmailAddresses(userId), LOOKUP_TIMEOUT_MS);
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    console.error(`${LOG} could not read the account's emails: user=${userId} status=${typeof status === "number" ? status : "none"} (${error instanceof Error ? error.name : "unknown"}); no trial offered`);
    return { kind: "unavailable", cause: "lookup-failed" };
  }

  const identity = trialIdentityOf(verifiedAddresses(addresses), pepper);
  if (identity.kind === "unavailable") console.warn(`${LOG} no verified email: user=${userId} addresses=${addresses.length}; no trial offered`);
  return identity;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`no answer in ${ms} ms`), { name: "TimeoutError" })), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const kept = new Map<string, { identity: TrialIdentity; until: number }>();

async function readAndKeep(userId: string): Promise<TrialIdentity> {
  const identity = await resolveTrialIdentity(userId);
  const failed = identity.kind === "unavailable" && identity.cause === "lookup-failed";
  kept.delete(userId);
  kept.set(userId, { identity, until: Date.now() + (failed ? KEEP_FAILED_MS : KEEP_MS) });
  if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value as string);
  return identity;
}

const perRequest = cache(async (userId: string): Promise<TrialIdentity> => {
  const hit = kept.get(userId);
  return hit && hit.until > Date.now() ? hit.identity : readAndKeep(userId);
});

/**
 * The account's trial identity for a page: once per request (React's `cache`) and kept a few minutes per instance, so
 * a Free account's pages do not each ask Clerk. Only the hashes are kept; whether one is claimed is read from the
 * database every time. `fresh` (the reservation) always asks Clerk.
 */
export function trialIdentityFor(userId: string, { fresh = false }: { fresh?: boolean } = {}): Promise<TrialIdentity> {
  return fresh ? readAndKeep(userId) : perRequest(userId);
}

/** Forgets every kept identity; tests only. */
export function forgetTrialIdentities(): void {
  kept.clear();
}
