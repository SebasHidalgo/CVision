// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_FAST_MS } from "@/lib/pollDelay";
import BillingActivation, { activationLanded, BILLING_POLL_CEILING_MS } from "./BillingActivation";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const snapshot = (plan: "FREE" | "PRO", credits: number) => ({
  plan,
  subscriptionStatus: plan === "PRO" ? "ACTIVE" : null,
  cancelAtPeriodEnd: false,
  periodEnd: "2026-11-05T00:00:00.000Z",
  interviewsLeft: plan === "PRO" ? 4 : 0,
  credits,
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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("activationLanded", () => {
  it("is Pro landing for a subscription, and more credits than before for a pack", () => {
    expect(activationLanded("pro_monthly", { plan: "FREE", credits: 0 }, snapshot("FREE", 0))).toBe(false);
    expect(activationLanded("pro_monthly", { plan: "FREE", credits: 0 }, snapshot("PRO", 0))).toBe(true);
    expect(activationLanded("interview_pack", { plan: "PRO", credits: 5 }, snapshot("PRO", 5))).toBe(false);
    expect(activationLanded("interview_pack", { plan: "PRO", credits: 5 }, snapshot("PRO", 10))).toBe(true);
  });
});

describe("BillingActivation", () => {
  it("says the plan is activating, polls the billing status, and refreshes once the webhook landed it", async () => {
    answer(snapshot("FREE", 0), snapshot("PRO", 0));
    render(<BillingActivation waitingFor="pro_monthly" seen={{ plan: "FREE", credits: 0 }} />);

    expect(screen.getByRole("status").textContent).toMatch(/Activating your plan/);
    expect(fetch).not.toHaveBeenCalled();

    await advance(POLL_FAST_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/billing/status");
    expect(refresh).not.toHaveBeenCalled();

    await advance(POLL_FAST_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Landed: no more polls.
    await advance(POLL_FAST_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits for more credits after a pack, not for the plan", async () => {
    answer(snapshot("PRO", 5), snapshot("PRO", 10));
    render(<BillingActivation waitingFor="interview_pack" seen={{ plan: "PRO", credits: 5 }} />);
    expect(screen.getByRole("status").textContent).toMatch(/Adding your credits/);

    await advance(POLL_FAST_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops at the ceiling and says the confirmation is late, never that the plan changed", async () => {
    answer(snapshot("FREE", 0));
    render(<BillingActivation waitingFor="pro_monthly" seen={{ plan: "FREE", credits: 0 }} />);

    await advance(BILLING_POLL_CEILING_MS + 1_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/taking longer than expected/);
    const polls = vi.mocked(fetch).mock.calls.length;
    await advance(60_000);
    expect(vi.mocked(fetch).mock.calls.length).toBe(polls);
  });
});
