import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY_NAME, MERCHANT_OF_RECORD } from "@/lib/legal";
import { INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS } from "@/lib/plans";

/** Every figure and placeholder the drafts print, from the constants the product enforces. */
export const LEGAL_VALUES = {
  entity: LEGAL_ENTITY_NAME,
  email: LEGAL_CONTACT_EMAIL,
  merchant: MERCHANT_OF_RECORD,
  freeAnalyses: PLANS.FREE.analysesPerMonth,
  proAnalyses: PLANS.PRO.analysesPerMonth,
  proInterviews: PLANS.PRO.interviewsPerMonth,
  packCredits: INTERVIEW_PACK_CREDITS,
  trialMinutes: INTERVIEW_TIERS.TRIAL.seconds / 60,
  fullMinutes: INTERVIEW_TIERS.FULL.seconds / 60,
};
