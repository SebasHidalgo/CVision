"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CheckoutItem } from "@/lib/billing/types";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import { cn } from "@/lib/utils";
import { createCheckoutAction } from "./actions/createCheckoutAction";
import { openCheckout } from "./paddle/paddleCheckout";

type CheckoutButtonProps = {
  item: CheckoutItem;
  label: string;
  /** Where to go once the payment completes; the page there waits for the webhook. */
  afterCompleteHref: string;
  className?: string;
  size?: "default" | "sm" | "lg";
  variant?: "default" | "outline";
};

/**
 * One purchase: the server mints the transaction, the provider's overlay
 * takes the payment, and the page that follows waits for the webhook to
 * land the change. The spinner stays up through a completed payment until
 * the navigation unmounts this; it resets on a refusal, a closed overlay or
 * a failed call.
 */
export default function CheckoutButton({ item, label, afterCompleteHref, className, size = "lg", variant = "default" }: CheckoutButtonProps) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      const result = await createCheckoutAction({ item });
      if (!result.ok) {
        toast.error(actionErrorCopy(result.code, result.meta));
        setBusy(false);
        return;
      }
      const outcome = await openCheckout(result.data.transactionId, resolvedTheme === "dark" ? "dark" : "light");
      if (outcome === "completed") {
        router.push(afterCompleteHref);
        return;
      }
    } catch (error) {
      // The action rejected (network, a stale deployment) or Paddle.js did not load.
      toast.error(actionErrorCopy(error instanceof Error && error.message.includes("Paddle.js") ? "BILLING_UNAVAILABLE" : "REQUEST_FAILED"));
    }
    setBusy(false);
  };

  return (
    <Button onClick={handleClick} disabled={busy} size={size} variant={variant} className={cn("gap-2", className)}>
      {busy ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Opening checkout…
        </>
      ) : (
        label
      )}
    </Button>
  );
}
