// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { POLL_FAST_MS, pollsDuring } from "@/lib/pollDelay";
import { checkBillingAction } from "../actions/checkBillingAction";
import BillingActivation, { BILLING_POLL_CEILING_MS, SUCCESS_LINGER_MS } from "./BillingActivation";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn() } }));
vi.mock("../actions/checkBillingAction", () => ({ checkBillingAction: vi.fn() }));

const TXN = "txn_01m5jdjv22mnssacjx9vbys9cv";
const pack = { item: "interview_pack" as const, transactionId: TXN };

const snapshot = (transactionApplied: boolean | null) => ({
  plan: "PRO",
  subscriptionStatus: "ACTIVE",
  cancelAtPeriodEnd: false,
  periodEnd: "2026-11-05T00:00:00.000Z",
  credits: 4,
  transactionApplied,
});

function answer(...snapshots: ReturnType<typeof snapshot>[]) {
  const queue = [...snapshots];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const data = queue.length > 1 ? queue.shift() : queue[0];
      return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

/** Advances the fake clock inside act, so React applies the state the polls set. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(checkBillingAction).mockResolvedValue({ ok: true, data: { applied: false } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BillingActivation", () => {
  it("polls the status for its transaction and ends exactly when the server says that transaction was applied", async () => {
    answer(snapshot(false), snapshot(false), snapshot(true));
    render(<BillingActivation activation={pack} applied={false} />);

    expect(screen.getByRole("status").textContent).toMatch(/Adding your credits/);
    expect(fetch).not.toHaveBeenCalled();

    await advance(POLL_FAST_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/billing/status?transactionId=${TXN}&item=interview_pack`);
    expect(screen.getByRole("status").textContent).toMatch(/Adding your credits/);

    await advance(POLL_FAST_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(POLL_FAST_MS);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status").textContent).toBe("Your credits are in.");

    // Landed: no more polls, and the URL is cleaned after the moment of confirmation.
    await advance(POLL_FAST_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(replace).toHaveBeenCalledWith("/account/billing");
  });

  it("a plan whose credits already matched before the poll is no signal: only the transaction flag is", async () => {
    // Same credits throughout (the webhook beat the page), flag false: the wait goes on.
    answer(snapshot(false));
    render(<BillingActivation activation={pack} applied={false} />);
    await advance(POLL_FAST_MS * 3);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/Adding your credits/);
  });

  it("when the server already saw the transaction applied at render, shows the result and cleans the URL without polling", async () => {
    answer(snapshot(true));
    render(<BillingActivation activation={{ item: "pro_monthly", transactionId: TXN }} applied />);
    expect(screen.getByRole("status").textContent).toBe("Pro is active.");
    await advance(SUCCESS_LINGER_MS + 10);
    expect(fetch).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/account/billing");
  });

  it("stops at the two-minute ceiling, says Paddle has the payment, and offers a check that asks the provider", async () => {
    answer(snapshot(false));
    render(<BillingActivation activation={pack} applied={false} />);

    await advance(BILLING_POLL_CEILING_MS + 1_000);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/confirmed by Paddle but hasn.t reached us yet/);
    const polls = vi.mocked(fetch).mock.calls.length;
    expect(polls).toBe(pollsDuring(BILLING_POLL_CEILING_MS));
    await advance(60_000);
    expect(vi.mocked(fetch).mock.calls.length).toBe(polls);

    // Not there yet: the page says so and stays checkable.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(checkBillingAction).toHaveBeenCalledWith({ transactionId: TXN });
    expect(toast.message).toHaveBeenCalledWith(expect.stringMatching(/Not here yet/));
    expect(screen.getByRole("button", { name: "Check again" })).toHaveProperty("disabled", false);

    // Repaired by the check: landed, URL cleaned.
    vi.mocked(checkBillingAction).mockResolvedValueOnce({ ok: true, data: { applied: true } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("status").textContent).toBe("Your credits are in.");
    await advance(SUCCESS_LINGER_MS + 10);
    expect(replace).toHaveBeenCalledWith("/account/billing");
  });

  it("shows the refusal of a rate-limited check without leaving the stalled state", async () => {
    answer(snapshot(false));
    render(<BillingActivation activation={pack} applied={false} />);
    await advance(BILLING_POLL_CEILING_MS + 1_000);

    vi.mocked(checkBillingAction).mockResolvedValueOnce({ ok: false, code: "RATE_LIMITED", meta: { retryAfter: 90 } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Too many requests/));
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });
});
