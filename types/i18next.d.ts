import "i18next";
import type account from "@/locales/en/account.json";
import type analysis from "@/locales/en/analysis.json";
import type billing from "@/locales/en/billing.json";
import type common from "@/locales/en/common.json";
import type errors from "@/locales/en/errors.json";
import type feedback from "@/locales/en/feedback.json";
import type interview from "@/locales/en/interview.json";
import type landing from "@/locales/en/landing.json";
import type legal from "@/locales/en/legal.json";
import type pricing from "@/locales/en/pricing.json";
import type sentences from "@/locales/en/sentences.json";
import type upload from "@/locales/en/upload.json";

// Type-safe keys: English is the source of truth; i18n.test.ts holds Spanish to the same keys.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      errors: typeof errors;
      landing: typeof landing;
      pricing: typeof pricing;
      account: typeof account;
      billing: typeof billing;
      upload: typeof upload;
      analysis: typeof analysis;
      interview: typeof interview;
      feedback: typeof feedback;
      legal: typeof legal;
      sentences: typeof sentences;
    };
    returnNull: false;
  }
}
