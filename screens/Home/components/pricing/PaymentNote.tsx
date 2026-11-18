"use client";

import Link from "next/link";
import { Trans, useTranslation } from "react-i18next";
import { MERCHANT_OF_RECORD } from "@/lib/legal";

const LINK = "text-ed-ink-2 underline underline-offset-[3px] hover:text-ed-ink";

/** Who takes the payment, how cancelling works, and where the refund policy and terms are. */
export function PaymentNote() {
  const { t } = useTranslation("landingPricing");
  return (
    <p className="mt-4 max-w-[52ch] text-[14px] text-ed-ink-3">
      <Trans
        t={t}
        i18nKey="note"
        values={{ merchant: MERCHANT_OF_RECORD }}
        components={{ refunds: <Link href="/refunds" className={LINK} />, terms: <Link href="/terms" className={LINK} /> }}
      />
    </p>
  );
}
