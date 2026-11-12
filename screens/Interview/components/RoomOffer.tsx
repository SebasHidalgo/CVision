"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { checkBillingAction } from "@/components/billing/actions/checkBillingAction";
import CheckoutButtonClient from "@/components/billing/CheckoutButtonClient";
import ManageSubscriptionButtonClient from "@/components/billing/ManageSubscriptionButtonClient";
import { useTransactionLanding } from "@/components/billing/useTransactionLanding";
import { Button } from "@/components/ui/button";
import { useErrorCopy, useResetDate } from "@/hooks/useErrorCopy";
import { activationHref, type Activation } from "@/lib/billing/activation";
import type { RoomEntry } from "@/lib/interviewEntry";

export type RoomOfferFacts = {
  /** Formatted in the interface's locale by the server, from the catalog. */
  prices: { pro: string; pack: string };
  proInterviewsPerMonth: number;
  fullMinutes: number;
  packCredits: number;
  periodLimit: number;
};

/** Still blocked this long after a paid checkout: "being confirmed" and Check again. */
export const PURCHASE_CONFIRM_MS = 20_000;

type RoomOfferProps = {
  entry: Extract<RoomEntry, { kind: "needs-pro" | "needs-pack" | "voice-down" }>;
  facts: RoomOfferFacts;
};

/** The room without Start: what would unlock it, voice down, or the blocking subscription's portal. */
export default function RoomOffer({ entry, facts }: RoomOfferProps) {
  const router = useRouter();
  const { t } = useTranslation("interview");
  const errorCopy = useErrorCopy();
  const resetDate = useResetDate();
  const [bought, setBought] = useState<Activation | null>(null);
  const [checking, setChecking] = useState(false);
  const { phase } = useTransactionLanding(bought);
  const landed = bought !== null && phase === "landed";
  // Still here (so still blocked) this long after the checkout completed.
  const [slow, setSlow] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Landed: the server reads the new entitlement and the room swaps this panel for Start.
  useEffect(() => {
    if (landed) router.refresh();
  }, [landed, router]);

  useEffect(() => {
    if (!bought) return;
    const timer = window.setTimeout(() => setSlow(true), PURCHASE_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [bought]);

  // Asks the provider for this transaction (the webhook may be lost), then re-reads the room.
  const checkPurchase = async () => {
    if (!bought) return;
    setConfirming(true);
    try {
      const result = await checkBillingAction({ transactionId: bought.transactionId });
      if (!result.ok) toast.error(errorCopy(result.code, result.meta));
      else if (result.data.applied) router.refresh();
      else toast.message(t("room.offer.notYet"));
    } catch {
      toast.error(errorCopy("REQUEST_FAILED"));
    }
    setConfirming(false);
  };

  if (entry.kind === "voice-down") {
    return (
      <div className="mt-12 w-full max-w-sm">
        <p className="text-sm leading-relaxed text-ink">{errorCopy("VOICE_UNAVAILABLE")}</p>
        <Button
          variant="outline"
          onClick={() => {
            setChecking(true);
            router.refresh();
            window.setTimeout(() => setChecking(false), 2_000);
          }}
          disabled={checking}
          className="mt-5 h-11 gap-2 px-5"
        >
          {checking ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
          {t("room.offer.checkAgain")}
        </Button>
      </div>
    );
  }

  if (bought) {
    return (
      <div role="status" className="mt-12 w-full max-w-sm text-sm leading-relaxed">
        {slow ? (
          <>
            <p className="text-ink">{t("room.offer.confirming")}</p>
            <Button variant="outline" onClick={checkPurchase} disabled={confirming} className="mt-5 h-11 gap-2 px-5">
              {confirming ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              {t("room.offer.checkAgain")}
            </Button>
            {phase === "stalled" && (
              <Link href={activationHref(bought)} className="link-rule mt-4 flex items-center gap-2 font-medium text-ink">
                {t("room.offer.openAccount")}
                <ArrowRight className="size-4" />
              </Link>
            )}
          </>
        ) : phase === "stalled" ? (
          <>
            <p className="text-ink">{t("room.offer.stalled")}</p>
            <Link href={activationHref(bought)} className="link-rule mt-4 inline-flex items-center gap-2 font-medium text-ink">
              {t("room.offer.openAccount")}
              <ArrowRight className="size-4" />
            </Link>
          </>
        ) : (
          <p className="flex items-center gap-3 text-ink">
            <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
            {landed ? t("room.offer.landed") : t("room.offer.waiting")}
          </p>
        )}
      </div>
    );
  }

  // An open subscription granting nothing: a Pro checkout would refuse, so the portal.
  if (entry.kind === "needs-pro" && entry.subscription) {
    return (
      <div className="mt-12 flex w-full max-w-sm flex-col">
        <p className="font-medium leading-relaxed text-ink">{t(entry.subscription === "paused" ? "room.offer.subscription.paused" : "room.offer.subscription.pending")}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{t(entry.subscription === "paused" ? "room.offer.subscription.pausedBody" : "room.offer.subscription.pendingBody")}</p>
        <ManageSubscriptionButtonClient className="mt-5 h-11 px-5" />
      </div>
    );
  }

  const pro = entry.kind === "needs-pro";
  return (
    <div className="mt-12 w-full max-w-sm flex flex-col">
      <p className="font-medium leading-relaxed text-ink">
        {pro
          ? t(entry.reason === "had-voice" ? "room.offer.pro.titleHadVoice" : "room.offer.pro.title")
          : t("room.offer.pack.title", { limit: facts.periodLimit, date: resetDate(entry.resetsAt) })}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        {pro
          ? t("room.offer.pro.body", { perMonth: facts.proInterviewsPerMonth, minutes: facts.fullMinutes })
          : t("room.offer.pack.body", { credits: facts.packCredits, price: facts.prices.pack })}
      </p>
      <CheckoutButtonClient
        item={pro ? "pro_monthly" : "interview_pack"}
        label={pro ? t("room.offer.pro.checkout", { price: facts.prices.pro }) : t("room.offer.pack.checkout", { credits: facts.packCredits, price: facts.prices.pack })}
        size="default"
        onPaid={setBought}
        className="mt-5 h-auto min-h-11 max-w-full whitespace-normal px-5 py-2 text-center"
      />
      {pro && (
        <Link href="/pricing" className="mx-auto link-rule mt-4 inline-flex items-center gap-2 text-sm text-ink-2">
          {t("room.offer.pro.seePricing")}
          <ArrowRight className="size-4" />
        </Link>
      )}
      {entry.kind === "needs-pack" && entry.pastDue && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="text-sm leading-relaxed text-ink">{t("room.offer.subscription.pastDue")}</p>
          <ManageSubscriptionButtonClient className="mt-3 h-11 px-5" />
        </div>
      )}
    </div>
  );
}
