import "server-only";

import enAccount from "@/locales/en/account.json";
import enAnalysis from "@/locales/en/analysis.json";
import enBilling from "@/locales/en/billing.json";
import enCommon from "@/locales/en/common.json";
import enErrors from "@/locales/en/errors.json";
import enFeedback from "@/locales/en/feedback.json";
import enInterview from "@/locales/en/interview.json";
import enLanding from "@/locales/en/landing.json";
import enLegal from "@/locales/en/legal.json";
import enPricing from "@/locales/en/pricing.json";
import enSentences from "@/locales/en/sentences.json";
import enUpload from "@/locales/en/upload.json";
import esAccount from "@/locales/es/account.json";
import esAnalysis from "@/locales/es/analysis.json";
import esBilling from "@/locales/es/billing.json";
import esCommon from "@/locales/es/common.json";
import esErrors from "@/locales/es/errors.json";
import esFeedback from "@/locales/es/feedback.json";
import esInterview from "@/locales/es/interview.json";
import esLanding from "@/locales/es/landing.json";
import esLegal from "@/locales/es/legal.json";
import esPricing from "@/locales/es/pricing.json";
import esSentences from "@/locales/es/sentences.json";
import esUpload from "@/locales/es/upload.json";
import type { Locale, Namespace } from "./config";
import type { LocaleResources } from "./instance";

// Server-only: the client gets the namespaces a page needs as props, never this whole table.

export const RESOURCES: Record<Locale, Record<Namespace, Record<string, unknown>>> = {
  en: {
    common: enCommon,
    errors: enErrors,
    landing: enLanding,
    pricing: enPricing,
    account: enAccount,
    billing: enBilling,
    upload: enUpload,
    analysis: enAnalysis,
    interview: enInterview,
    feedback: enFeedback,
    legal: enLegal,
    sentences: enSentences,
  },
  es: {
    common: esCommon,
    errors: esErrors,
    landing: esLanding,
    pricing: esPricing,
    account: esAccount,
    billing: esBilling,
    upload: esUpload,
    analysis: esAnalysis,
    interview: esInterview,
    feedback: esFeedback,
    legal: esLegal,
    sentences: esSentences,
  },
};

/** The given namespaces of one locale: what a client provider receives. */
export function pickResources(locale: Locale, namespaces: readonly Namespace[]): LocaleResources {
  return Object.fromEntries(namespaces.map((ns) => [ns, RESOURCES[locale][ns]]));
}
