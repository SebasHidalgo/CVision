"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ACCOUNT_BILLING_PATH, type Activation } from "@/lib/billing/activation";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import { pollDelayMs } from "@/lib/pollDelay";
import { billingStatusSnapshotSchema } from "@/lib/schemas/billingSchema";
import { checkBillingAction } from "../actions/checkBillingAction";

type BillingActivationProps = {
  activation: Activation;
  /** What the server saw at render: true when the transaction had already been applied. */
  applied: boolean;
};

/** The webhook usually lands within seconds; after this the page says so and offers a check instead of polling on. */
export const BILLING_POLL_CEILING_MS = 2 * 60_000;

/** How long the success state stays before the URL is cleaned. */
export const SUCCESS_LINGER_MS = 2_500;

type Phase = "waiting" | "landed" | "stalled" | "checking";

/**
 * After a completed checkout: polls the billing status for the transaction
 * the URL names, with the interview page's backoff, until the server says
 * that transaction has been applied. Then it shows the result briefly and
 * replaces the URL with the plain account page, so a refresh cannot bring
 * the wait back. Past the ceiling it stops polling and offers "Check
 * again", which asks the provider directly (rate-limited). Nothing here
 * ever claims the change before the database has it.
 */
export default function BillingActivation({ activation, applied }: BillingActivationProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(applied ? "landed" : "waiting");

  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // The poll: only while waiting, tied to the transaction, never restarted by a re-render.
  useEffect(() => {
    if (applied) return;
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
        const response = await fetch(`/api/billing/status?transactionId=${encodeURIComponent(activation.transactionId)}`, {
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
  }, [activation.transactionId, applied]);

  // Landed: a moment of confirmation, then the plain page, re-read from the server.
  useEffect(() => {
    if (phase !== "landed") return;
    const timer = window.setTimeout(() => routerRef.current.replace(ACCOUNT_BILLING_PATH), SUCCESS_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const checkAgain = async () => {
    setPhase("checking");
    try {
      const result = await checkBillingAction({ transactionId: activation.transactionId });
      if (!result.ok) {
        toast.error(actionErrorCopy(result.code, result.meta));
      } else if (result.data.applied) {
        setPhase("landed");
        return;
      } else {
        toast.message("Not here yet. Paddle has the payment; it will appear shortly.");
      }
    } catch {
      toast.error(actionErrorCopy("REQUEST_FAILED"));
    }
    setPhase("stalled");
  };

  const pro = activation.item === "pro_monthly";

  if (phase === "landed") {
    return (
      <p className="flex items-center gap-3 text-lg text-ink" role="status">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-signal" />
        {pro ? "Pro is active." : "Your credits are in."}
      </p>
    );
  }

  if (phase === "waiting") {
    return (
      <p className="flex items-center gap-3 text-lg text-ink" role="status">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-signal animate-blink" />
        {pro ? "Activating your plan…" : "Adding your credits…"} Your payment went through; the confirmation from Paddle usually takes a few
        seconds.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4" role="status">
      <p className="flex items-center gap-3 text-lg text-ink">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-fair" />
        Your payment is confirmed by Paddle but hasn&rsquo;t reached us yet. It will appear shortly; you can refresh later.
      </p>
      <Button onClick={checkAgain} disabled={phase === "checking"} variant="outline" size="sm" className="gap-2">
        {phase === "checking" && <Loader2 className="size-4 animate-spin" />}
        Check again
      </Button>
    </div>
  );
}
