import { initializePaddle, type PaddleEventData } from "@paddle/paddle-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_TIMEOUT_MS, openCheckout } from "./paddleCheckout";

/**
 * Paddle.js replayed. The fake reproduces the one behaviour that broke the
 * checkout after M6-B, read in Paddle.js 1.6.5's own source: `Checkout.close()`
 * emits `checkout.closed` to the event callback synchronously, from inside
 * close() itself. So the sequence a successful overlay produces, as seen by
 * our callback, is: loaded, completed (with the transaction id), and then,
 * because we close the overlay on completion, closed, before close() even
 * returns.
 */

vi.mock("@paddle/paddle-js", () => ({ initializePaddle: vi.fn() }));

let emit: (event: PaddleEventData) => void = () => {};
const open = vi.fn();
const close = vi.fn(() => {
  // What the real close() does: the callback runs before close() returns.
  emit({ name: "checkout.closed", data: {} } as unknown as PaddleEventData);
});

const event = (name: string, data: Record<string, unknown> = {}) => ({ name, data }) as unknown as PaddleEventData;
const TXN = "txn_01m5jdjv22mnssacjx9vbys9cv";

/** Opens and waits until Paddle.js has been asked to open the overlay (a few microtasks behind the load). */
function start(...args: Parameters<typeof openCheckout>) {
  const before = open.mock.calls.length;
  const outcome = openCheckout(...args);
  const ready = (async () => {
    for (let i = 0; i < 20 && open.mock.calls.length === before; i++) await Promise.resolve();
  })();
  return Object.assign(outcome, { ready });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_token");
  vi.mocked(initializePaddle).mockImplementation(async (options) => {
    emit = (e) => options?.eventCallback?.(e);
    return { Checkout: { open, close } } as never;
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openCheckout against Paddle.js's real sequence", () => {
  it("resolves completed, not closed, when the overlay completes and our own close() echoes a synchronous checkout.closed", async () => {
    const outcome = start(TXN, "light");
    await outcome.ready;
    expect(open).toHaveBeenCalledWith({ transactionId: TXN, settings: { displayMode: "overlay", theme: "light" } });

    emit(event("checkout.loaded", { transaction_id: TXN, status: "ready" }));
    emit(event("checkout.customer.created", { transaction_id: TXN }));
    emit(event("checkout.payment.initiated", { transaction_id: TXN }));
    emit(event("checkout.completed", { transaction_id: TXN, status: "completed" }));
    // close() ran, and inside it the closed event hit the callback; the outcome was already settled.
    expect(close).toHaveBeenCalledTimes(1);
    expect(await outcome).toBe("completed");

    // A late close from the overlay's own teardown changes nothing either.
    emit(event("checkout.closed"));
    expect(await outcome).toBe("completed");
  });

  it("resolves closed when the buyer closes without paying, and never closes the overlay itself", async () => {
    const outcome = start(TXN, "dark");
    await outcome.ready;
    emit(event("checkout.loaded", { transaction_id: TXN }));
    emit(event("checkout.closed"));
    expect(await outcome).toBe("closed");
    expect(close).not.toHaveBeenCalled();
  });

  it("resolves error on checkout.error or checkout.failed and closes the overlay once; payment-level errors are not outcomes", async () => {
    let outcome = start(TXN, "light");
    await outcome.ready;
    emit(event("checkout.loaded"));
    emit(event("checkout.payment.error", { transaction_id: TXN }));
    emit(event("checkout.payment.failed", { transaction_id: TXN }));
    // Still open: the buyer may try another card.
    let settled = false;
    void outcome.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    emit(event("checkout.error", { transaction_id: TXN }));
    expect(await outcome).toBe("error");
    expect(close).toHaveBeenCalledTimes(1);

    close.mockClear();
    outcome = start(TXN, "light");
    await outcome.ready;
    emit(event("checkout.failed"));
    expect(await outcome).toBe("error");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("gives up on an overlay that reports nothing within the open timeout, but any event cancels that clock", async () => {
    vi.useFakeTimers();
    let outcome = start(TXN, "light");
    await outcome.ready;
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1);
    expect(await outcome).toBe("timeout");
    expect(close).toHaveBeenCalledTimes(1);

    close.mockClear();
    outcome = start(TXN, "light");
    await outcome.ready;
    emit(event("checkout.loaded"));
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS * 3);
    let settled = false;
    void outcome.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    emit(event("checkout.completed", { transaction_id: TXN }));
    expect(await outcome).toBe("completed");
  });

  it("stops listening when aborted (the button went away) and resolves closed", async () => {
    const controller = new AbortController();
    const outcome = start(TXN, "light", { signal: controller.signal });
    await outcome.ready;
    controller.abort();
    expect(await outcome).toBe("closed");
    emit(event("checkout.completed", { transaction_id: TXN }));
    expect(close).not.toHaveBeenCalled();
  });

  it("records every event with its transaction in development, for a real sequence to be read off the console", async () => {
    const outcome = start(TXN, "light");
    await outcome.ready;
    emit(event("checkout.loaded", { transaction_id: TXN, status: "ready" }));
    emit(event("checkout.completed", { transaction_id: TXN, status: "completed" }));
    await outcome;
    const lines = vi.mocked(console.info).mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.startsWith("[CVision][paddle] "))).toEqual([
      expect.stringMatching(/^\[CVision\]\[paddle\] checkout\.loaded txn=txn_01m5jdjv22mnssacjx9vbys9cv status=ready at=/),
      expect.stringMatching(/^\[CVision\]\[paddle\] checkout\.completed txn=txn_01m5jdjv22mnssacjx9vbys9cv status=completed at=/),
      expect.stringMatching(/^\[CVision\]\[paddle\] checkout\.closed txn=- status=- at=/),
    ]);
  });
});
