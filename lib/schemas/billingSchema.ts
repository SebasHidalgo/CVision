import { z } from "zod";
import { CHECKOUT_ITEMS } from "@/lib/billing/types";

/** What the checkout button sends: which item, nothing about who pays. */
export const checkoutInputSchema = z.object({
  item: z.enum(CHECKOUT_ITEMS),
});

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

/**
 * What `GET /api/billing/status` answers: enough for the account page to
 * know when the webhook-driven change it waits for has landed.
 */
export const billingStatusSnapshotSchema = z.object({
  plan: z.enum(["FREE", "PRO"]),
  /** The subscription's status as stored, or null without one. */
  subscriptionStatus: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** ISO date; the period's end for a subscription, the month's for the rest. */
  periodEnd: z.string(),
  interviewsLeft: z.number().int().min(0),
  credits: z.number().int().min(0),
});

export type BillingStatusSnapshot = z.infer<typeof billingStatusSnapshotSchema>;
