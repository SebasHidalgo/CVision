import { BRAND } from "@/lib/brand";

/**
 * The placeholders the legal pages (terms, privacy, refunds) print until the
 * owner finalizes them with legal help before launch. No company name is
 * invented: the entity is a visible placeholder held in lib/brand.ts, and
 * every page carries a draft banner. The billing provider is named because
 * it is the merchant of record and must appear on those pages for its own
 * review.
 */

/** Replaced by the seller's legal name (the owner, as an individual) in the deploy phase. */
export const LEGAL_ENTITY_NAME = BRAND.legalEntityName;

/** Replaced by a real address for legal requests in the deploy phase. */
export const LEGAL_CONTACT_EMAIL = BRAND.supportEmail;

/** The merchant of record for every purchase: it appears on the buyer's statement and handles refunds and taxes. */
export const MERCHANT_OF_RECORD = "Paddle";

export const LEGAL_DRAFT_DATE = "2026-10-20";

export const LEGAL_DRAFT_BANNER = `DRAFT — not legal advice — to be reviewed before launch. These pages are placeholders written by the product team, not by a lawyer, and will be replaced before ${BRAND.name} sells anything.`;
