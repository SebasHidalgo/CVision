"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { BILLING_POLL_CEILING_MS, useTransactionLanding } from "@/components/billing/useTransactionLanding";
import { ACCOUNT_BILLING_PATH, type Activation } from "@/lib/billing/activation";
import { checkBillingAction } from "../actions/checkBillingAction";

type BillingActivationProps = {
  activation: Activation;
  /** What the server saw at render: true when the transaction had already been applied. */
  applied: boolean;
};

export { BILLING_POLL_CEILING_MS };

/** How long the success state stays before the URL is cleaned. */
export const SUCCESS_LINGER_MS = 2_500;

/**
 * After a completed checkout: polls the billing status for the transaction
 * the URL names (useTransactionLanding) until the server says that
 * transaction has been applied. Then it shows the result briefly and
 * replaces the URL with the plain account page, so a refresh cannot bring
 * the wait back. Past the ceiling it stops polling and offers "Check
 * again", which asks the provider directly (rate-limited). Its words are in
 * the account namespace, which the screen sends.
 */
export default function BillingActivation({ activation, applied }: BillingActivationProps) {
  const router = useRouter();
  const { t } = useTranslation("account");
  const errorCopy = useErrorCopy();
  const { phase, setPhase } = useTransactionLanding(activation, applied);

  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

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
        toast.error(errorCopy(result.code, result.meta));
      } else if (result.data.applied) {
        setPhase("landed");
        return;
      } else {
        toast.message(t("activation.notYet"));
      }
    } catch {
      toast.error(errorCopy("REQUEST_FAILED"));
    }
    setPhase("stalled");
  };

  const pro = activation.item === "pro_monthly";

  if (phase === "landed") {
    return (
      <p className="flex items-center gap-3 text-lg text-ink" role="status">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-signal" />
        {t(pro ? "activation.landedPro" : "activation.landedPack")}
      </p>
    );
  }

  if (phase === "waiting") {
    return (
      <p className="flex items-center gap-3 text-lg text-ink" role="status">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-signal animate-blink" />
        {t(pro ? "activation.waitingPro" : "activation.waitingPack")}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4" role="status">
      <p className="flex items-center gap-3 text-lg text-ink">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-fair" />
        {t("activation.stalled")}
      </p>
      <Button onClick={checkAgain} disabled={phase === "checking"} variant="outline" size="sm" className="gap-2">
        {phase === "checking" && <Loader2 className="size-4 animate-spin" />}
        {t("activation.checkAgain")}
      </Button>
    </div>
  );
}
