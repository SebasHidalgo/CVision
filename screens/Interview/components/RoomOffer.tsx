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
import { buttonClass, textLinkClass } from "@/components/design-system/Button";
import { PanelLine, PanelSub } from "@/components/interview/room/RoomView";
import { useErrorCopy, useResetDate } from "@/hooks/useErrorCopy";
import { activationHref, type Activation } from "@/lib/billing/activation";
import type { RoomEntry } from "@/lib/interviewEntry";
import { cn } from "@/lib/utils";

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

/** Dev preview only: the room as it looks after a purchase, without one. */
export type PurchasePreview = "waiting" | "confirming" | "stalled";

type RoomOfferProps = {
  entry: Extract<RoomEntry, { kind: "needs-pro" | "needs-pack" | "voice-down" }>;
  facts: RoomOfferFacts;
  preview?: PurchasePreview;
};

// The billing buttons are the old system's (shadcn): these classes dress them as the design system's pills, with its focus ring.
const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[3px] focus-visible:outline-ed-ink focus-visible:ring-0";
const SOLID = cn(buttonClass({ variant: "solid", size: "md" }), FOCUS, "h-auto w-full whitespace-normal py-2.5 text-center shadow-none hover:bg-ed-ink disabled:opacity-75 sm:w-auto");
const GHOST = cn(buttonClass({ variant: "ghost", size: "md" }), FOCUS, "h-auto bg-transparent shadow-none hover:bg-transparent hover:text-ed-ink disabled:opacity-75");
const LINK = cn(textLinkClass, "gap-2 text-ed-ink underline decoration-ed-ink-3 underline-offset-4");

const PREVIEW_PURCHASE: Activation = { item: "pro_monthly", transactionId: "txn_preview" };

/** The room without Start: what would unlock it, voice down, or the blocking subscription's portal. */
export default function RoomOffer({ entry, facts, preview }: RoomOfferProps) {
  const router = useRouter();
  const { t } = useTranslation("interview");
  const errorCopy = useErrorCopy();
  const resetDate = useResetDate();
  const [bought, setBought] = useState<Activation | null>(preview ? PREVIEW_PURCHASE : null);
  const [checking, setChecking] = useState(false);
  // A preview never polls: it has no purchase to wait for.
  const landing = useTransactionLanding(preview ? null : bought);
  const phase = preview === "stalled" ? "stalled" : landing.phase;
  const landed = bought !== null && phase === "landed";
  // Still here (so still blocked) this long after the checkout completed.
  const [slow, setSlow] = useState(preview === "confirming");
  const [confirming, setConfirming] = useState(false);

  // Landed: the server reads the new entitlement and the room swaps this panel for Start.
  useEffect(() => {
    if (landed) router.refresh();
  }, [landed, router]);

  useEffect(() => {
    if (!bought || preview) return;
    const timer = window.setTimeout(() => setSlow(true), PURCHASE_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [bought, preview]);

  // Asks the provider for this transaction (the webhook may be lost), then re-reads the room.
  const checkPurchase = async () => {
    if (!bought || preview) return;
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
      <div data-offer="voice-down">
        <PanelLine>{errorCopy("VOICE_UNAVAILABLE")}</PanelLine>
        <button
          type="button"
          onClick={() => {
            setChecking(true);
            router.refresh();
            window.setTimeout(() => setChecking(false), 2_000);
          }}
          disabled={checking}
          className={cn(buttonClass({ variant: "ghost", size: "md" }), "mt-5 disabled:opacity-75")}
        >
          {checking ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <RotateCcw aria-hidden className="size-4" />}
          {t("room.offer.checkAgain")}
        </button>
      </div>
    );
  }

  if (bought) {
    return (
      <div role="status" data-offer="purchase" data-purchase={slow ? "confirming" : phase}>
        {slow ? (
          <>
            <PanelLine>{t("room.offer.confirming")}</PanelLine>
            <button type="button" onClick={checkPurchase} disabled={confirming} className={cn(buttonClass({ variant: "ghost", size: "md" }), "mt-5 disabled:opacity-75")}>
              {confirming ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <RotateCcw aria-hidden className="size-4" />}
              {t("room.offer.checkAgain")}
            </button>
            {phase === "stalled" && (
              <Link href={activationHref(bought)} className={cn(LINK, "mt-3 flex w-fit")}>
                {t("room.offer.openAccount")}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            )}
          </>
        ) : phase === "stalled" ? (
          <>
            <PanelLine>{t("room.offer.stalled")}</PanelLine>
            <Link href={activationHref(bought)} className={cn(LINK, "mt-3")}>
              {t("room.offer.openAccount")}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </>
        ) : (
          <PanelLine className="flex items-start gap-3">
            <Loader2 aria-hidden className="mt-1 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
            {landed ? t("room.offer.landed") : t("room.offer.waiting")}
          </PanelLine>
        )}
      </div>
    );
  }

  // An open subscription granting nothing: a Pro checkout would refuse, so the portal.
  if (entry.kind === "needs-pro" && entry.subscription) {
    return (
      <div data-offer="subscription">
        <PanelLine className="font-medium">{t(entry.subscription === "paused" ? "room.offer.subscription.paused" : "room.offer.subscription.pending")}</PanelLine>
        <PanelSub>{t(entry.subscription === "paused" ? "room.offer.subscription.pausedBody" : "room.offer.subscription.pendingBody")}</PanelSub>
        <div className="mt-5">
          <ManageSubscriptionButtonClient className={GHOST} />
        </div>
      </div>
    );
  }

  const pro = entry.kind === "needs-pro";
  return (
    <div data-offer={pro ? "pro" : "pack"} className="flex flex-col items-start">
      <PanelLine className="font-medium">
        {pro
          ? t(entry.reason === "had-voice" ? "room.offer.pro.titleHadVoice" : "room.offer.pro.title")
          : t("room.offer.pack.title", { limit: facts.periodLimit, date: resetDate(entry.resetsAt) })}
      </PanelLine>
      <PanelSub className="max-w-[52ch]">
        {pro
          ? t("room.offer.pro.body", { perMonth: facts.proInterviewsPerMonth, minutes: facts.fullMinutes })
          : t("room.offer.pack.body", { credits: facts.packCredits, price: facts.prices.pack })}
      </PanelSub>
      <CheckoutButtonClient
        item={pro ? "pro_monthly" : "interview_pack"}
        label={pro ? t("room.offer.pro.checkout", { price: facts.prices.pro }) : t("room.offer.pack.checkout", { credits: facts.packCredits, price: facts.prices.pack })}
        size="default"
        onPaid={setBought}
        className={cn(SOLID, "mt-5")}
      />
      {pro && (
        <Link href="/pricing" className={cn(LINK, "mt-2")}>
          {t("room.offer.pro.seePricing")}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      )}
      {entry.kind === "needs-pack" && entry.pastDue && (
        <div className="mt-6 w-full border-t border-ed-line pt-5">
          <PanelLine>{t("room.offer.subscription.pastDue")}</PanelLine>
          <div className="mt-4">
            <ManageSubscriptionButtonClient className={GHOST} />
          </div>
        </div>
      )}
    </div>
  );
}
