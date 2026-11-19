import Link from "next/link";
import RichText from "@/components/i18n/RichText";
import { CATALOG_CURRENCY } from "@/lib/billing/catalog";
import { MERCHANT_OF_RECORD } from "@/lib/legal";

const LINK = "text-ed-ink underline decoration-ed-ink-3 underline-offset-4 hover:decoration-ed-ink";

/** The currency, who takes the payment, how cancelling works, and the refund policy and terms. Server only. */
export function PaymentNote() {
  return (
    <p data-pricing-part="note" className="mt-6 max-w-[68ch] text-ed-ink-2">
      <RichText
        ns="pricing"
        i18nKey="note"
        values={{ currency: CATALOG_CURRENCY, merchant: MERCHANT_OF_RECORD }}
        components={{ refunds: <Link href="/refunds" className={LINK} />, terms: <Link href="/terms" className={LINK} /> }}
      />
    </p>
  );
}
