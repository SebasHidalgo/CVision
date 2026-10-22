import { z } from "zod";
import { TRANSACTION_ID_PATTERN } from "@/lib/billing/activation";
import { CHECKOUT_ITEMS } from "@/lib/billing/types";

/** What the checkout button sends: which item, nothing about who pays. */
export const checkoutInputSchema = z.object({
  item: z.enum(CHECKOUT_ITEMS),
});

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

/** The transaction the account page waits for, as the status poll and the "Check again" action receive it. */
export const transactionIdSchema = z.string().regex(TRANSACTION_ID_PATTERN);

export const checkBillingInputSchema = z.object({
  transactionId: transactionIdSchema,
});

/**
 * What `GET /api/billing/status` answers: the plan in force, the credits,
 * and, when the poll names a transaction, whether that transaction has been
 * applied (the pack's grant exists, or the subscription it created is
 * mirrored). The account page ends its wait on that flag, not on a guess.
 */
export const billingStatusSnapshotSchema = z.object({
  plan: z.enum(["FREE", "PRO"]),
  /** The subscription's status as stored, or null without one. */
  subscriptionStatus: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** ISO date; the period's end for a subscription, the month's for the rest. */
  periodEnd: z.string(),
  credits: z.number().int().min(0),
  /** Null when the poll named no transaction. */
  transactionApplied: z.boolean().nullable(),
});

export type BillingStatusSnapshot = z.infer<typeof billingStatusSnapshotSchema>;
