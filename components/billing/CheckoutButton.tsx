"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { activationHref } from "@/lib/billing/activation";
import type { CheckoutItem } from "@/lib/billing/types";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import { cn } from "@/lib/utils";
import { createCheckoutAction } from "./actions/createCheckoutAction";
import { openCheckout } from "./paddle/paddleCheckout";

type CheckoutButtonProps = {
  item: CheckoutItem;
  label: string;
  className?: string;
  size?: "default" | "sm" | "lg";
  variant?: "default" | "outline";
};

/**
 * "opening" lasts from the click until Paddle.js reports the overlay up;
 * "open" is the overlay in front of the page, where the button has nothing
 * to say and only has to stay out of the way (disabled, its own label).
 */
type Phase = "idle" | "opening" | "open" | "paid";

/**
 * After a payment the button says so and sends the buyer to the account
 * page, which waits for that transaction's webhook. On the account page the
 * navigation only changes the search params, so this very instance may
 * stay mounted: the server then renders the waiting state in its place,
 * and if for any reason it has not within this long, the button resets by
 * itself rather than sit on "paid" forever.
 */
export const PAID_RESET_MS = 8_000;

/**
 * One purchase: the server mints the transaction, the provider's overlay
 * takes the payment, and the account page that follows waits for the
 * webhook to land the change. Every way the overlay can end is an outcome
 * (completed, closed, error, never opened), so the spinner never outlives
 * the overlay; a page restored from the back-forward cache, or this
 * instance going away, drops the pending overlay's outcome.
 */
export default function CheckoutButton({ item, label, className, size = "lg", variant = "default" }: CheckoutButtonProps) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [phase, setPhase] = useState<Phase>("idle");

  // The overlay in flight, if any: aborted when this instance goes away.
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const onPageShow = (event: PageTransitionEvent) => {
      // Back to a page the browser kept alive: whatever was in flight is over.
      if (event.persisted) {
        pending.current?.abort();
        setPhase("idle");
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      mounted.current = false;
      pending.current?.abort();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    if (phase !== "paid") return;
    const timer = window.setTimeout(() => setPhase("idle"), PAID_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const handleClick = async () => {
    setPhase("opening");
    const controller = new AbortController();
    pending.current = controller;
    try {
      const result = await createCheckoutAction({ item });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        toast.error(actionErrorCopy(result.code, result.meta));
        setPhase("idle");
        return;
      }
      const { transactionId } = result.data;
      const outcome = await openCheckout(transactionId, resolvedTheme === "dark" ? "dark" : "light", {
        signal: controller.signal,
        onLoaded: () => {
          if (!controller.signal.aborted && mounted.current) setPhase("open");
        },
      });
      if (controller.signal.aborted || !mounted.current) return;
      if (outcome === "completed") {
        setPhase("paid");
        router.push(activationHref({ item, transactionId }));
        return;
      }
      if (outcome === "error" || outcome === "timeout") {
        toast.error(actionErrorCopy("BILLING_UNAVAILABLE"));
      }
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      // The action rejected (network, a stale deployment) or Paddle.js did not load.
      toast.error(actionErrorCopy(error instanceof Error && error.message.includes("Paddle.js") ? "BILLING_UNAVAILABLE" : "REQUEST_FAILED"));
    } finally {
      if (pending.current === controller) pending.current = null;
    }
    setPhase("idle");
  };

  return (
    <Button onClick={handleClick} disabled={phase !== "idle"} size={size} variant={variant} className={cn("gap-2", className)}>
      {phase === "opening" ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Opening checkout…
        </>
      ) : phase === "paid" ? (
        <>
          <Check className="size-4" />
          Payment received…
        </>
      ) : (
        label
      )}
    </Button>
  );
}
