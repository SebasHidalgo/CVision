import { initializePaddle, type Paddle, type PaddleEventData } from "@paddle/paddle-js";

/**
 * Paddle.js in the browser, loaded on demand by the pages that sell. The
 * only Paddle value the browser holds is the client-side token, public by
 * design; the environment is read off its prefix so sandbox and production
 * cannot be mixed. The overlay opens on a transaction the server created,
 * so nothing here chooses a price or a payer.
 */

export type CheckoutOutcome = "completed" | "closed";

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

/**
 * Opens the overlay for a server-created transaction and resolves when the
 * payment completes (the overlay is closed here, so a navigation that
 * follows does not leave it floating) or when the buyer closes it.
 */
export async function openCheckout(transactionId: string, theme: "light" | "dark"): Promise<CheckoutOutcome> {
  const paddle = await loadPaddle();
  if (!paddle) throw new Error("Paddle.js is not available");

  return new Promise<CheckoutOutcome>((resolve) => {
    const listener: Listener = (event) => {
      if (event.name === "checkout.completed") {
        listeners.delete(listener);
        paddle.Checkout.close();
        resolve("completed");
      } else if (event.name === "checkout.closed") {
        listeners.delete(listener);
        resolve("closed");
      }
    };
    listeners.add(listener);
    paddle.Checkout.open({ transactionId, settings: { displayMode: "overlay", theme } });
  });
}
