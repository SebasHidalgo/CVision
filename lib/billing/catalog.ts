import { INTERVIEW_PACK_CREDITS, PLANS } from "@/lib/plans";
import type { PriceKey } from "./types";

/**
 * The catalog as code: what is sold, for how much, described how. The sync
 * script pushes it to the provider, the pricing page reads it, and the
 * webhook maps the provider's price ids back to these keys. One place, so
 * the price on the page and the price at checkout cannot disagree.
 *
 * The wording describes CVision as what it is: a self-assessment and
 * practice tool a job seeker uses on their own CV and their own interview
 * answers, with an AI voice interviewer. Never a screening, evaluation or
 * hiring tool, never coaching, never a person.
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
  /** The amount in major units, for the page. */
  amountLabel: string;
};

export const CATALOG: Record<PriceKey, CatalogProduct> = {
  pro_monthly: {
    key: "pro_monthly",
    name: "CVision Pro",
    description:
      `Monthly subscription to CVision Pro, a self-assessment and practice tool for job seekers: unlimited checks of your own CV against job postings, ${PLANS.PRO.interviewsPerMonth} practice interviews a month with an AI voice interviewer (up to 12 minutes each), and your full history.`,
    amountMinor: "1500",
    interval: "month",
    amountLabel: "$15",
  },
  interview_pack: {
    key: "interview_pack",
    name: "CVision interview pack",
    description: `One-time pack of ${INTERVIEW_PACK_CREDITS} extra practice interviews with the AI voice interviewer, for CVision Pro subscribers. The credits do not expire while Pro is active.`,
    amountMinor: "900",
    interval: null,
    amountLabel: "$9",
  },
};

/** What the pricing page promises, in the order it lists them. Exactly the owner's table, nothing more. */
export const PLAN_PROMISES = {
  FREE: [
    "3 CV checks per month",
    "One 5-minute practice interview with the AI interviewer",
    "Your last 3 analyses",
  ],
  PRO: [
    "Unlimited CV analyses",
    `${PLANS.PRO.interviewsPerMonth} voice interviews per month, up to 12 minutes`,
    `Interview packs: ${INTERVIEW_PACK_CREDITS} more for ${CATALOG.interview_pack.amountLabel}`,
    "Your full history",
  ],
} as const;
