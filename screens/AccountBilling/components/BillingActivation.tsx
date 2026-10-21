"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CheckoutItem } from "@/lib/billing/types";
import { pollDelayMs } from "@/lib/pollDelay";
import { billingStatusSnapshotSchema, type BillingStatusSnapshot } from "@/lib/schemas/billingSchema";

type BillingActivationProps = {
  waitingFor: CheckoutItem;
  /** What the page rendered with; the change is anything beyond it. */
  seen: { plan: "FREE" | "PRO"; credits: number };
};

/** The webhook usually lands within seconds; after this the page says so instead of spinning. */
export const BILLING_POLL_CEILING_MS = 10 * 60_000;

/** True when the snapshot shows the change the page waits for. */
export function activationLanded(waitingFor: CheckoutItem, seen: BillingActivationProps["seen"], now: BillingStatusSnapshot): boolean {
  return waitingFor === "pro_monthly" ? now.plan === "PRO" : now.credits > seen.credits;
}

/**
 * After a completed checkout: polls the billing status with the same
 * backoff as the interview page and re-renders the server component once
 * the webhook-driven change has landed. The page itself never claims the
 * plan changed before the database says so.
 */
export default function BillingActivation({ waitingFor, seen }: BillingActivationProps) {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);

  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const mountedAt = Date.now();

    const schedule = () => {
      if (cancelled) return;
      const delay = pollDelayMs(Date.now() - mountedAt);
      if (Date.now() + delay - mountedAt > BILLING_POLL_CEILING_MS) {
        setStalled(true);
        return;
      }
      timer = window.setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const response = await fetch("/api/billing/status", { headers: { accept: "application/json" }, cache: "no-store" });
        if (response.status === 401) return;
        const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
        if (body?.ok === true) {
          const parsed = billingStatusSnapshotSchema.safeParse(body.data);
          if (parsed.success && activationLanded(waitingFor, seen, parsed.data)) {
            routerRef.current.refresh();
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
    // The baseline is this mount's; a re-render must not restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingFor]);

  const what = waitingFor === "pro_monthly" ? "Activating your plan…" : "Adding your credits…";

  if (!stalled) {
    return (
      <p className="flex items-center gap-3 text-lg text-ink" role="status">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-signal animate-blink" />
        {what} Your payment went through; the confirmation from Paddle usually takes a few seconds.
      </p>
    );
  }

  return (
    <p className="flex items-center gap-3 text-lg text-ink" role="status">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-fair" />
      The confirmation is taking longer than expected. Your payment went through; reload in a minute, and if this page still shows the old
      plan, tell us and we will sync it by hand.
    </p>
  );
}
