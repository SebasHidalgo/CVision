// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createCheckoutAction } from "./actions/createCheckoutAction";
import CheckoutButton, { PAID_RESET_MS } from "./CheckoutButton";
import { openCheckout, paddleEnvironmentOf, type CheckoutOutcome } from "./paddle/paddleCheckout";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn() } }));
vi.mock("./actions/createCheckoutAction", () => ({ createCheckoutAction: vi.fn() }));
vi.mock("./paddle/paddleCheckout", () => ({
  openCheckout: vi.fn(),
  paddleEnvironmentOf: (token: string | undefined) =>
    token?.startsWith("test_") ? "sandbox" : token?.startsWith("live_") ? "production" : null,
}));

const TXN = "txn_01m5jdjv22mnssacjx9vbys9cv";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createCheckoutAction).mockResolvedValue({ ok: true, data: { transactionId: TXN } });
  vi.mocked(openCheckout).mockResolvedValue("completed");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mount = () => render(<CheckoutButton item="interview_pack" label="Buy 4 more interviews" />);
const button = () => screen.getByRole("button");

describe("CheckoutButton", () => {
  it("asks the server for the transaction, opens the overlay on it, and hands the transaction to the account page on completion", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Buy 4 more interviews" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/account/billing?activating=interview_pack&txn=${TXN}`));
    expect(createCheckoutAction).toHaveBeenCalledWith({ item: "interview_pack" });
    expect(openCheckout).toHaveBeenCalledWith(TXN, "dark", { signal: expect.any(AbortSignal) });
    // Paid, not "opening": the label says so until the page takes over.
    expect(button().textContent).toMatch(/Payment received/);
    expect(button()).toHaveProperty("disabled", true);
  });

  it("resets by itself if the page has not replaced it after a payment (same route, only the query changed)", async () => {
    vi.useFakeTimers();
    mount();
    await act(async () => {
      fireEvent.click(button());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(button().textContent).toMatch(/Payment received/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAID_RESET_MS + 10);
    });
    expect(button().textContent).toBe("Buy 4 more interviews");
    expect(button()).toHaveProperty("disabled", false);
  });

  it.each<[CheckoutOutcome, RegExp | null]>([
    ["closed", null],
    ["error", /Billing isn't responding/],
    ["timeout", /Billing isn't responding/],
  ])("leaves the spinner when the overlay ends with %s, and says so when it was not the buyer's choice", async (outcome, copy) => {
    vi.mocked(openCheckout).mockResolvedValueOnce(outcome);
    mount();
    fireEvent.click(button());
    await waitFor(() => expect(button()).toHaveProperty("disabled", false));
    expect(button().textContent).toBe("Buy 4 more interviews");
    expect(push).not.toHaveBeenCalled();
    if (copy) expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(copy));
    else expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows the refusal's copy and never opens the overlay", async () => {
    vi.mocked(createCheckoutAction).mockResolvedValueOnce({ ok: false, code: "PACK_REQUIRES_PRO" });
    mount();
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Pro subscribers/)));
    expect(openCheckout).not.toHaveBeenCalled();
    expect(button()).toHaveProperty("disabled", false);
  });

  it("handles the two ways the call itself can fail: the action rejected, or Paddle.js did not load", async () => {
    vi.mocked(createCheckoutAction).mockRejectedValueOnce(new Error("network"));
    mount();
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/didn't go through/)));

    vi.mocked(openCheckout).mockRejectedValueOnce(new Error("Paddle.js is not available"));
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Billing isn't responding/)));
  });

  it("drops the outcome of an overlay whose button went away, and resets when the page comes back from the cache", async () => {
    let settle: (outcome: CheckoutOutcome) => void = () => {};
    let aborted = false;
    vi.mocked(openCheckout).mockImplementationOnce((_id, _theme, options) => {
      options?.signal?.addEventListener("abort", () => (aborted = true));
      return new Promise((resolve) => (settle = resolve));
    });
    const view = mount();
    fireEvent.click(button());
    await waitFor(() => expect(openCheckout).toHaveBeenCalled());

    view.unmount();
    expect(aborted).toBe(true);
    settle("completed");
    await Promise.resolve();
    expect(push).not.toHaveBeenCalled();

    // A page restored from the back-forward cache: whatever was in flight is over.
    mount();
    fireEvent.click(button());
    await waitFor(() => expect(button().textContent).toMatch(/Payment received/));
    act(() => {
      const event = new Event("pageshow");
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
    });
    expect(button().textContent).toBe("Buy 4 more interviews");
  });
});

describe("paddleEnvironmentOf", () => {
  it("reads the environment off the client token's prefix, and refuses anything else", () => {
    expect(paddleEnvironmentOf("test_abc")).toBe("sandbox");
    expect(paddleEnvironmentOf("live_abc")).toBe("production");
    expect(paddleEnvironmentOf("abc")).toBeNull();
    expect(paddleEnvironmentOf(undefined)).toBeNull();
  });
});
