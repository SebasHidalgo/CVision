"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Mark } from "@/components/account/Mark";
import { buttonClass } from "@/components/design-system/Button";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { BILLING_POLL_CEILING_MS, useTransactionLanding } from "@/components/billing/useTransactionLanding";
import { ACCOUNT_BILLING_PATH, type Activation } from "@/lib/billing/activation";
import { checkBillingAction } from "@/components/billing/actions/checkBillingAction";

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
      <p className="flex items-center gap-3 text-ed-body font-medium text-ed-ink" role="status">
        <Mark shape="filled" />
        {t(pro ? "activation.landedPro" : "activation.landedPack")}
      </p>
    );
  }

  if (phase === "waiting") {
    return (
      <p className="flex items-start gap-3 text-ed-body text-ed-ink" role="status">
        <Mark shape="half" className="mt-[0.45em] motion-safe:animate-pulse" />
        {t(pro ? "activation.waitingPro" : "activation.waitingPack")}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4" role="status">
      <p className="flex items-start gap-3 text-ed-body text-ed-ink">
        <Mark shape="half" className="mt-[0.45em]" />
        {t("activation.stalled")}
      </p>
      <button
        type="button"
        onClick={checkAgain}
        disabled={phase === "checking"}
        aria-busy={phase === "checking" || undefined}
        className={buttonClass({ variant: "ghost", size: "sm", className: "disabled:cursor-progress disabled:opacity-75" })}
      >
        {phase === "checking" && <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
        {t("activation.checkAgain")}
      </button>
    </div>
  );
}
