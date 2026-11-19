import { BRAND } from "@/lib/brand";

/**
 * The placeholders the legal pages (terms, privacy, refunds) print until the
 * owner finalizes them with legal help before launch. No company name is
 * invented: the entity is a visible placeholder held in lib/brand.ts, and
 * every page carries a draft banner (its words are in locales/<locale>/legal.json,
 * draft.banner). The billing provider is named because it is the merchant of
 * record and must appear on those pages for its own review.
 */

/** Replaced by the seller's legal name (the owner, as an individual) in the deploy phase. */
export const LEGAL_ENTITY_NAME = BRAND.legalEntityName;

/** Replaced by a real address for legal requests in the deploy phase. */
export const LEGAL_CONTACT_EMAIL = BRAND.supportEmail;

/** The merchant of record for every purchase: it appears on the buyer's statement and handles refunds and taxes. */
export const MERCHANT_OF_RECORD = "Paddle";

export const LEGAL_PAGES = ["terms", "privacy", "refunds"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

/**
 * When each page's text last changed (UTC day), printed as "Last updated". `screens/Legal/legalDates.test.ts` holds a
 * fingerprint of each page's words in both languages and fails when they change without this date moving.
 */
export const LEGAL_UPDATED: Record<LegalPage, string> = {
  terms: "2026-11-18",
  privacy: "2026-11-18",
  refunds: "2026-11-11",
};
