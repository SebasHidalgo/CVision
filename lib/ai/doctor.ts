import "server-only";

import { pingModel, readListedModelVersion, type ModelPing } from "@/lib/ai/client";
import { AppError, type ErrorCode } from "@/lib/error/errors";

// `npm run ai:doctor`: one minimal call, its outcome, and what answered. Never prints the key.

export type AiDoctorOutcome = "ok" | "rate-limited" | "billing-exhausted" | "misconfigured" | "unavailable" | "bad-format" | "blocked" | "unknown";

export type AiDoctorReport = {
  outcome: AiDoctorOutcome;
  /** One line a person can act on. */
  detail: string;
  ping: ModelPing | null;
  /** The dated build the models listing reports for the alias. */
  listedVersion: string | null;
};

const OUTCOME_OF: Partial<Record<ErrorCode, AiDoctorOutcome>> = {
  AI_RATE_LIMITED: "rate-limited",
  AI_BILLING: "billing-exhausted",
  AI_MISCONFIGURED: "misconfigured",
  AI_UNAVAILABLE: "unavailable",
  AI_BAD_FORMAT: "bad-format",
  AI_CONTENT_BLOCKED: "blocked",
};

const FIX: Record<AiDoctorOutcome, string> = {
  ok: "",
  "rate-limited": "The quota is hit; wait, or raise the limits in Google AI Studio.",
  "billing-exhausted": "Add balance or raise the spend cap in Google AI Studio > Billing. Every analysis fails until then (each is refunded).",
  misconfigured: "Check GOOGLE_GENERATIVE_AI_API_KEY, AI_PROVIDER and AI_MODEL.",
  unavailable: "The provider did not answer; try again in a few minutes.",
  "bad-format": "The provider answered outside the schema; try again, and run the canary.",
  blocked: "The provider's safety filter refused a one-line prompt; check the account.",
  unknown: "An untyped error; see the line above.",
};

/** The error as its outcome and the code's message (which never carries content). */
function describe(error: unknown): { outcome: AiDoctorOutcome; detail: string } {
  if (error instanceof AppError) {
    const outcome = OUTCOME_OF[error.code] ?? "unknown";
    return { outcome, detail: `${error.code}: ${error.message}` };
  }
  return { outcome: "unknown", detail: error instanceof Error ? error.name : typeof error };
}

export async function runAiDoctor(): Promise<AiDoctorReport> {
  try {
    const ping = await pingModel();
    const listedVersion = await readListedModelVersion(ping.model);
    return { outcome: "ok", detail: `answered in ${ping.ms} ms (${ping.input ?? "?"} in / ${ping.output ?? "?"} out tokens)`, ping, listedVersion };
  } catch (error) {
    const { outcome, detail } = describe(error);
    return { outcome, detail, ping: null, listedVersion: null };
  }
}

export function fixFor(outcome: AiDoctorOutcome): string {
  return FIX[outcome];
}
