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

/**
 * Development only: every Paddle.js event, in order, with the transaction
 * it names, so a real checkout's sequence can be read off the console (the
 * sandbox's overlay is the only place that sequence exists). Compiled out
 * of production builds.
 */
function recordEvent(event: PaddleEventData): void {
  if (process.env.NODE_ENV === "production") return;
  const data = event.data as { transaction_id?: string; status?: string } | undefined;
  console.info(`[CVision][paddle] ${event.name} txn=${data?.transaction_id ?? "-"} status=${data?.status ?? "-"} at=${new Date().toISOString()}`);
}

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
      recordEvent(event);
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
  /** Called once, when the overlay reports itself up (`checkout.loaded`): the button stops saying it is opening. */
  onLoaded?: () => void;
};

/**
 * Opens the overlay for a server-created transaction and resolves with
 * its outcome. On completion the overlay is closed here, so the navigation
 * that follows does not leave it floating; on an error or a load failure
 * it is closed too, so the button that resets cannot sit beside a dead
 * overlay. An overlay that reports nothing at all within the open timeout
 * is treated as never opened. Aborted: resolves "closed" and listens no
 * more.
 *
 * Order matters: Paddle.js's `Checkout.close()` emits `checkout.closed` to
 * the event callback **synchronously, from inside close()** (its source:
 * `close = function(){ bt({name: CHECKOUT_CLOSE, data: {}}), vt() }`). A
 * listener still registered at that moment sees a close right after the
 * completion and, if it settles on the first event it sees, reports the
 * payment as a close: that is the regression the owner found after M6-B.
 * So the outcome is settled, and the listener removed, before close() is
 * called, and a settled listener ignores whatever follows.
 */
export async function openCheckout(
  transactionId: string,
  theme: "light" | "dark",
  { signal, openTimeoutMs = OPEN_TIMEOUT_MS, onLoaded }: OpenCheckoutOptions = {},
): Promise<CheckoutOutcome> {
  const paddle = await loadPaddle();
  if (!paddle) throw new Error("Paddle.js is not available");
  if (signal?.aborted) return "closed";

  return new Promise<CheckoutOutcome>((resolve) => {
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let loaded = false;
    const finish = (outcome: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      listeners.delete(listener);
      signal?.removeEventListener("abort", onAbort);
      if (openTimer) clearTimeout(openTimer);
      resolve(outcome);
    };
    const onAbort = () => finish("closed");

    const listener: Listener = (event) => {
      if (settled) return;
      // Any event means Paddle.js is alive and the overlay is up.
      if (openTimer) {
        clearTimeout(openTimer);
        openTimer = null;
      }
      if (event.name === "checkout.loaded" && !loaded) {
        loaded = true;
        onLoaded?.();
      }
      if (event.name === "checkout.completed") {
        finish("completed");
        paddle.Checkout.close();
      } else if (event.name === "checkout.closed") {
        finish("closed");
      } else if (event.name === "checkout.error" || event.name === "checkout.failed") {
        finish("error");
        paddle.Checkout.close();
      }
    };

    listeners.add(listener);
    signal?.addEventListener("abort", onAbort);
    openTimer = setTimeout(() => {
      finish("timeout");
      paddle.Checkout.close();
    }, openTimeoutMs);
    paddle.Checkout.open({ transactionId, settings: { displayMode: "overlay", theme } });
  });
}
