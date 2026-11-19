"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { buttonClass } from "@/components/design-system/Button";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { useLocale } from "@/hooks/useLocale";
import { activationHref, type Activation } from "@/lib/billing/activation";
import type { CheckoutItem } from "@/lib/billing/types";
import { cn } from "@/lib/utils";
import { createCheckoutAction } from "./actions/createCheckoutAction";
import { BILLING_BUTTON } from "./buttonStyle";
import { openCheckout } from "./paddle/paddleCheckout";

export type CheckoutButtonProps = {
  item: CheckoutItem;
  /** Already translated by the screen: it names the item and its price. */
  label: string;
  className?: string;
  size?: "default" | "sm" | "lg";
  variant?: "default" | "outline";
  /** Set by a page that waits for the purchase itself (the interview room): no navigation to the account page. */
  onPaid?: (activation: Activation) => void;
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

// The overlay matches the site, which has one dark design.
const OVERLAY_THEME = "dark";

// The callers' sizes and variants (the old buttons' names) on the design system's pill.
const SIZE = { default: "md", lg: "md", sm: "sm" } as const;
const VARIANT = { default: "solid", outline: "ghost" } as const;

/**
 * One purchase: the server mints the transaction, the provider's overlay
 * takes the payment, and the account page that follows waits for the
 * webhook to land the change. Every way the overlay can end is an outcome
 * (completed, closed, error, never opened), so the spinner never outlives
 * the overlay; a page restored from the back-forward cache, or this
 * instance going away, drops the pending overlay's outcome. Rendered through
 * CheckoutButton, which sends it the billing namespace.
 */
export default function CheckoutButtonClient({ item, label, className, size = "lg", variant = "default", onPaid }: CheckoutButtonProps) {
  const router = useRouter();
  const { t } = useTranslation("billing");
  const locale = useLocale();
  const errorCopy = useErrorCopy();
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
        toast.error(errorCopy(result.code, result.meta));
        setPhase("idle");
        return;
      }
      const { transactionId } = result.data;
      const outcome = await openCheckout(transactionId, OVERLAY_THEME, locale, {
        signal: controller.signal,
        onLoaded: () => {
          if (!controller.signal.aborted && mounted.current) setPhase("open");
        },
      });
      if (controller.signal.aborted || !mounted.current) return;
      if (outcome === "completed") {
        setPhase("paid");
        if (onPaid) onPaid({ item, transactionId });
        else router.push(activationHref({ item, transactionId }));
        return;
      }
      // An overlay that never opened is a different story from a provider that failed: the retry is immediate.
      if (outcome === "timeout") toast.error(errorCopy("CHECKOUT_NOT_OPENED"));
      else if (outcome === "error") toast.error(errorCopy("BILLING_UNAVAILABLE"));
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      // The action rejected (network, a stale deployment) or Paddle.js did not load.
      toast.error(errorCopy(error instanceof Error && error.message.includes("Paddle.js") ? "BILLING_UNAVAILABLE" : "REQUEST_FAILED"));
    } finally {
      if (pending.current === controller) pending.current = null;
    }
    setPhase("idle");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={phase !== "idle"}
      aria-busy={phase === "opening" || undefined}
      className={buttonClass({ variant: VARIANT[variant], size: SIZE[size], className: cn(BILLING_BUTTON, className) })}
    >
      {phase === "opening" ? (
        <>
          <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {t("checkout.opening")}
        </>
      ) : phase === "paid" ? (
        <>
          <Check aria-hidden className="size-4" />
          {t("checkout.paid")}
        </>
      ) : (
        label
      )}
    </button>
  );
}
