import { BRAND } from "@/lib/brand";
import { INTERVIEW_PACK_CREDITS, PLANS } from "@/lib/plans";
import type { PriceKey } from "./types";

/**
 * The catalog as code: what is sold, for how much, described how. The sync
 * script pushes it to the provider, the pricing page reads it, and the
 * webhook maps the provider's price ids back to these keys. One place, so
 * the price on the page and the price at checkout cannot disagree.
 * Names and descriptions are single-language product data (the provider
 * shows them at checkout and on invoices); the page's own copy, the plan
 * promises included, is in locales/<locale>/pricing.json.
 *
 * The wording describes the product as what it is: a self-assessment and
 * practice tool a job seeker uses on their own CV and their own interview
 * answers, with an AI voice interviewer. Never a tool run on other people,
 * never a service by a person, never a person's voice (see the wording test
 * in screens/Home).
 */

export const CATALOG_CURRENCY = "USD" as const;

export type CatalogProduct = {
  key: PriceKey;
  name: string;
  /** Customer-facing: shown at checkout and on invoices. */
  description: string;
  /** Minor units (cents), as a string, the way providers take money. */
  amountMinor: string;
  /** Null for a one-time purchase. */
  interval: "month" | null;
  /**
   * Interview credits one unit of this price grants, for a pack. Read at
   * the time a completed transaction's event is applied and stored on the
   * grant, so a change here sells the new size from then on and touches no
   * grant already made.
   */
  credits?: number;
};

export const CATALOG: Record<PriceKey, CatalogProduct> = {
  pro_monthly: {
    key: "pro_monthly",
    name: `${BRAND.name} Pro`,
    description:
      `Monthly subscription to ${BRAND.name} Pro, a self-assessment and practice tool for job seekers: unlimited checks of your own CV against job postings, ${PLANS.PRO.interviewsPerMonth} practice interviews a month with an AI voice interviewer (up to 12 minutes each), and your full history.`,
    amountMinor: "1500",
    interval: "month",
  },
  interview_pack: {
    key: "interview_pack",
    name: `${BRAND.name} interview pack (${INTERVIEW_PACK_CREDITS} interviews)`,
    description: `One-time pack of ${INTERVIEW_PACK_CREDITS} voice interviews, up to 12 minutes each, with the AI voice interviewer: extra practice for ${BRAND.name} Pro subscribers. The credits never expire and stay usable after the subscription ends.`,
    amountMinor: "900",
    interval: null,
    credits: INTERVIEW_PACK_CREDITS,
  },
};
