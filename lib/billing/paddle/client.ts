import "server-only";

import { ApiError, Environment, Paddle } from "@paddle/paddle-node-sdk";
import {
  type AppError,
  BillingMisconfiguredError,
  BillingUnavailableError,
} from "@/lib/error/errors";

/**
 * The Paddle SDK, constructed. The environment comes from PADDLE_ENV and
 * from nowhere else: the SDK's own default is production, so it is never
 * left to default, and a missing or misspelt value is a refusal, not a
 * guess. The key has to match the environment (Paddle prefixes them), so
 * a live key cannot be used against the sandbox or the other way round.
 * Read per call, not at import, so a test can set these per case.
 */

export type PaddleEnvironmentName = "sandbox" | "production";

const KEY_PREFIX: Record<PaddleEnvironmentName, string> = {
  sandbox: "pdl_sdbx_",
  production: "pdl_live_",
};

export function readPaddleEnvironment(): PaddleEnvironmentName {
  const value = process.env.PADDLE_ENV?.trim();
  if (value === "sandbox" || value === "production") return value;
  throw new BillingMisconfiguredError(
    `PADDLE_ENV must be "sandbox" or "production", got ${value ? JSON.stringify(value) : "nothing"}`,
  );
}

export type PaddleConfig = {
  environment: PaddleEnvironmentName;
  apiKey: string;
  webhookSecret: string | null;
};

export function readPaddleConfig(): PaddleConfig {
  const environment = readPaddleEnvironment();
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  if (!apiKey) throw new BillingMisconfiguredError("PADDLE_API_KEY is not set");
  if (!apiKey.startsWith(KEY_PREFIX[environment])) {
    throw new BillingMisconfiguredError(`PADDLE_API_KEY is not a ${environment} key`);
  }
  return {
    environment,
    apiKey,
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET?.trim() || null,
  };
}

export function paddleClient(): Paddle {
  const { environment, apiKey } = readPaddleConfig();
  return new Paddle(apiKey, {
    environment: environment === "sandbox" ? Environment.sandbox : Environment.production,
  });
}

/** One SDK call; the SDK has no timeout of its own, so the wait is bounded here. */
export const PADDLE_CALL_TIMEOUT_MS = 10_000;

/**
 * Runs one provider call with a bound on the wait and the SDK's failures
 * translated into the app's taxonomy. The SDK error is never kept as
 * `cause`: its detail can echo the request.
 */
export async function paddleCall<T>(what: string, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new BillingUnavailableError(`Paddle ${what} timed out after ${PADDLE_CALL_TIMEOUT_MS} ms`)),
      PADDLE_CALL_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch (error) {
    throw toBillingError(error, what);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Paddle answers 4xx as `request_error` (our request was wrong: an unknown
 * price, a bad body, an id that is not ours) and 5xx as `api_error`; a 429
 * carries `retryAfter`. The first is misconfiguration, the rest and any
 * network failure is the provider being unavailable.
 */
export function toBillingError(error: unknown, what: string): AppError {
  if (error instanceof BillingUnavailableError || error instanceof BillingMisconfiguredError) return error;
  if (error instanceof ApiError) {
    if (error.retryAfter !== null || error.type === "api_error") {
      return new BillingUnavailableError(`Paddle ${what} failed (${error.code})`);
    }
    return new BillingMisconfiguredError(`Paddle rejected ${what} (${error.code})`);
  }
  return new BillingUnavailableError(
    `Paddle ${what} failed with ${error instanceof Error ? error.name : typeof error}`,
  );
}

/** The provider's error code, when the failure was one of its answers. */
export function paddleErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}
