import { initializePaddle, type Paddle, type PaddleEventData } from "@paddle/paddle-js";

/**
 * Paddle.js in the browser, loaded on demand by the pages that sell. The
 * only Paddle value the browser holds is the client-side token, public by
 * design; the environment is read off its prefix so sandbox and production
 * cannot be mixed. The overlay opens on a transaction the server created,
 * so nothing here chooses a price or a payer.
 *
 * The outcome of an overlay comes from Paddle.js v2's event callback. The
 * names below are the ones the installed Paddle.js (1.6.5) declares in
 * `CheckoutEventNames`: `checkout.loaded` (the overlay is up),
 * `checkout.completed`, `checkout.closed`, `checkout.error` and
 * `checkout.failed`. The payment-level events (`checkout.payment.error`, a
 * declined card) are not outcomes: the overlay stays open and the buyer
 * tries another card.
 */

export type CheckoutOutcome =
  | "completed"
  /** The buyer closed the overlay without paying. */
  | "closed"
  /** Paddle reported an error or a failure to load; the overlay is closed here. */
  | "error"
  /** No event at all within OPEN_TIMEOUT_MS: Paddle.js never opened. The overlay is closed here. */
  | "timeout";

/** How long the overlay gets to report anything before the button gives up on it. */
export const OPEN_TIMEOUT_MS = 20_000;

type Listener = (event: PaddleEventData) => void;
const listeners = new Set<Listener>();
let instance: Promise<Paddle | undefined> | null = null;

/** Paddle's client tokens say which account they open: `test_` the sandbox, `live_` production. */
export function paddleEnvironmentOf(token: string | undefined): "sandbox" | "production" | null {
  if (!token) return null;
  if (token.startsWith("test_")) return "sandbox";
  if (token.startsWith("live_")) return "production";
  return null;
}

export function loadPaddle(): Promise<Paddle | undefined> {
  if (instance) return instance;
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  const environment = paddleEnvironmentOf(token);
  if (!token || !environment) return Promise.resolve(undefined);

  instance = initializePaddle({
    token,
    environment,
    eventCallback: (event) => {
      for (const listener of listeners) listener(event);
    },
  }).catch(() => {
    instance = null;
    return undefined;
  });
  return instance;
}

export type OpenCheckoutOptions = {
  /** Aborting stops listening: the caller went away (unmounted, navigated back) and no outcome is wanted. */
  signal?: AbortSignal;
  openTimeoutMs?: number;
};

/**
 * Opens the overlay for a server-created transaction and resolves with
 * its outcome. On completion the overlay is closed here, so the navigation
 * that follows does not leave it floating; on an error or a load failure
 * it is closed too, so the button that resets cannot sit beside a dead
 * overlay. An overlay that reports nothing at all within the open timeout
 * is treated as never opened. Aborted: resolves "closed" and listens no
 * more.
 */
export async function openCheckout(
  transactionId: string,
  theme: "light" | "dark",
  { signal, openTimeoutMs = OPEN_TIMEOUT_MS }: OpenCheckoutOptions = {},
): Promise<CheckoutOutcome> {
  const paddle = await loadPaddle();
  if (!paddle) throw new Error("Paddle.js is not available");
  if (signal?.aborted) return "closed";

  return new Promise<CheckoutOutcome>((resolve) => {
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (outcome: CheckoutOutcome) => {
      listeners.delete(listener);
      signal?.removeEventListener("abort", onAbort);
      if (openTimer) clearTimeout(openTimer);
      resolve(outcome);
    };
    const onAbort = () => finish("closed");

    const listener: Listener = (event) => {
      // Any event means Paddle.js is alive and the overlay is up.
      if (openTimer) {
        clearTimeout(openTimer);
        openTimer = null;
      }
      if (event.name === "checkout.completed") {
        paddle.Checkout.close();
        finish("completed");
      } else if (event.name === "checkout.closed") {
        finish("closed");
      } else if (event.name === "checkout.error" || event.name === "checkout.failed") {
        paddle.Checkout.close();
        finish("error");
      }
    };

    listeners.add(listener);
    signal?.addEventListener("abort", onAbort);
    openTimer = setTimeout(() => {
      paddle.Checkout.close();
      finish("timeout");
    }, openTimeoutMs);
    paddle.Checkout.open({ transactionId, settings: { displayMode: "overlay", theme } });
  });
}
