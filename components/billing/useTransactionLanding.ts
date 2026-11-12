"use client";

import { useEffect, useState } from "react";
import type { Activation } from "@/lib/billing/activation";
import { pollDelayMs } from "@/lib/pollDelay";
import { billingStatusSnapshotSchema } from "@/lib/schemas/billingSchema";

/** The webhook usually lands within seconds; after this the page says so and stops polling. */
export const BILLING_POLL_CEILING_MS = 2 * 60_000;

export type LandingPhase = "waiting" | "landed" | "stalled" | "checking";

/**
 * After a completed checkout: polls the billing status for the named
 * transaction, with the interview page's backoff, until the server says it
 * has been applied, or the ceiling passes. Nothing here claims the change
 * before the database has it. Null activation: nothing to wait for.
 */
export function useTransactionLanding(activation: Activation | null, applied = false) {
  const [phase, setPhase] = useState<LandingPhase>(applied ? "landed" : "waiting");
  const transactionId = activation?.transactionId ?? null;
  const item = activation?.item ?? null;

  useEffect(() => {
    if (applied || !transactionId || !item) return;
    let cancelled = false;
    let timer: number | null = null;
    const mountedAt = Date.now();

    const schedule = () => {
      if (cancelled) return;
      const delay = pollDelayMs(Date.now() - mountedAt);
      if (Date.now() + delay - mountedAt > BILLING_POLL_CEILING_MS) {
        setPhase("stalled");
        return;
      }
      timer = window.setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/billing/status?transactionId=${encodeURIComponent(transactionId)}&item=${item}`, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (response.status === 401) return;
        const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
        if (body?.ok === true) {
          const parsed = billingStatusSnapshotSchema.safeParse(body.data);
          if (parsed.success && parsed.data.transactionApplied === true) {
            cancelled = true;
            setPhase("landed");
            return;
          }
        }
      } catch {
        // A transient failure; the next poll tries again.
      }
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [transactionId, item, applied]);

  return { phase, setPhase };
}
