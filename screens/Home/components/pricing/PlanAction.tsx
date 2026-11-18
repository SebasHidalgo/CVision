"use client";

import { useTranslation } from "react-i18next";
import { StartCta } from "@/screens/Home/components/StartCta";
import { ProCta } from "./ProCta";

/** A plan's button: Free starts an account (or the upload), Pro goes through the pricing page's checkout. */
export function PlanAction({ plan, className }: { plan: "free" | "pro"; className?: string }) {
  const { t } = useTranslation("landingPricing");
  return plan === "free" ? (
    <StartCta label={t("cta.free")} signedInLabel={t("cta.freeSignedIn")} variant="ghost" className={className} />
  ) : (
    <ProCta label={t("cta.pro")} signedInLabel={t("cta.proSignedIn")} className={className} />
  );
}
