// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStanding } from "@/lib/billing/access";
import type { Activation } from "@/lib/billing/activation";
import type { UsageSummary } from "@/lib/database/usage";
import type { Locale, Namespace } from "@/lib/i18n/config";
import { decideEntitlement } from "@/lib/interviewEntitlement";
import { PLANS, type PlanId } from "@/lib/plans";
import AccountBillingScreen from "./AccountBillingScreen";

// The design system's face comes from next/font, which only runs under Next.
vi.mock("next/font/google", () => ({ Host_Grotesk: () => ({ variable: "font-text" }) }));

const request = vi.hoisted(() => ({ locale: "en" as Locale, summary: null as unknown }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
// The screen is a server component: getT reads the real locale files, in the language the test sets.
vi.mock("@/lib/i18n/server", async () => {
  const { tFor } = await import("@/lib/i18n/testing");
  return {
    getT: async (ns: Namespace) => tFor(ns, request.locale),
    getLocale: async () => request.locale,
  };
});
vi.mock("@/lib/database/usage", () => ({
  currentUsageSummary: async () => request.summary,
  currentTransactionApplied: async () => false,
  currentOpenSubscriptionStatus: async () => null,
}));
vi.mock("@/components/billing/CheckoutButton", () => ({
  default: ({ item, label }: { item: string; label: string }) => (
    <button type="button" data-checkout={item}>
      {label}
    </button>
  ),
}));
vi.mock("@/components/billing/ManageSubscriptionButton", () => ({ default: () => <button type="button" data-portal /> }));
vi.mock("@/components/i18n/ClientMessages", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./components/BillingActivation", () => ({ default: () => <p data-activation-status /> }));

const PERIOD_END = new Date("2026-12-01T00:00:00.000Z");

function summaryOf(
  plan: PlanId,
  { credits = 0, pending = 0, hadVoice = false }: { credits?: number; pending?: number; hadVoice?: boolean } = {},
  standing: { source?: UsageSummary["source"]; subscription?: SubscriptionStanding | null; hasBillingAccount?: boolean } = {},
): UsageSummary {
  const entitlement = decideEntitlement({ plan, periodUsed: 0, credits, trialsUsed: 0, hadVoice, periodEnd: PERIOD_END });
  return {
    plan,
    source: standing.source ?? (plan === "PRO" ? "comp" : "free"),
    analyses: { used: 1, limit: PLANS[plan].analysesPerMonth, left: PLANS[plan].analysesPerMonth - 1, announce: PLANS[plan].announceAnalyses },
    interviews: { used: 0, limit: PLANS[plan].interviewsPerMonth, left: entitlement.remaining.period },
    credits: { balance: credits, pending },
    trial: { available: entitlement.remaining.trial > 0, used: false },
    entitlement,
    period: { start: new Date("2026-11-01T00:00:00.000Z"), end: PERIOD_END },
    resetsAt: PERIOD_END,
    subscription: standing.subscription ?? null,
    everSubscribed: hadVoice,
    hasBillingAccount: standing.hasBillingAccount ?? false,
  };
}

function subscription(overrides: Partial<SubscriptionStanding>): SubscriptionStanding {
  return {
    id: "row",
    providerSubscriptionId: "sub",
    status: "ACTIVE",
    priceKey: "pro_monthly",
    currentPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    scheduledChangeAt: null,
    canceledAt: null,
    providerUpdatedAt: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function renderIn(locale: Locale, summary: UsageSummary, activation: Activation | null = null) {
  request.locale = locale;
  request.summary = summary;
  const { container } = render(await AccountBillingScreen({ activation }));
  const checkouts = [...container.querySelectorAll("[data-checkout]")].map((node) => node.getAttribute("data-checkout"));
  return { container, checkouts, portal: container.querySelector("[data-portal]") !== null, text: (container.textContent ?? "").replace(/\s+/g, " ") };
}

afterEach(cleanup);

describe("Plan & billing", () => {
  it("offers Free the subscription, with what it includes, and no pack", async () => {
    const page = await renderIn("en", summaryOf("FREE"));
    expect(page.text).toContain("You're on Free.");
    expect(page.text).toContain("No subscription");
    expect(page.text).toContain("Pro is $15 a month: 4 voice interviews of up to 12 minutes and up to 50 analyses.");
    expect(page.checkouts).toEqual(["pro_monthly"]);
    expect(page.portal).toBe(false);
    expect(page.text).toContain("Packs of 4 more interviews are sold with Pro.");
    expect(page.text).not.toContain("Interview credits");
  });

  it("gives a renewing Pro the portal and the pack, never a second subscription", async () => {
    const page = await renderIn("en", summaryOf("PRO", {}, { source: "subscription", subscription: subscription({}), hasBillingAccount: true }));
    expect(page.text).toContain("You're on Pro.");
    expect(page.text).toContain("Active");
    expect(page.text).toContain("Renews on December 1, 2026.");
    expect(page.checkouts).toEqual(["interview_pack"]);
    expect(page.portal).toBe(true);
    expect(page.text).toContain("“Manage subscription” opens Paddle");
    expect(page.text).toMatch(/Interview credits\s*0/);
  });

  it("past due: the portal to fix the card, Pro kept while Paddle retries, and no 'until' date", async () => {
    const page = await renderIn("en", summaryOf("PRO", {}, { source: "subscription", subscription: subscription({ status: "PAST_DUE" }), hasBillingAccount: true }));
    expect(page.text).toContain("Payment failed");
    expect(page.text).toContain("Paddle is retrying it over the next few days. Pro stays on meanwhile: update your payment method in the billing portal to keep it.");
    expect(page.text).not.toContain("December 1, 2026");
    expect(page.portal).toBe(true);
    expect(page.checkouts).toEqual(["interview_pack"]);
  });

  it("paused: Free, the portal to resume, and no Pro checkout (it would be refused)", async () => {
    const page = await renderIn(
      "en",
      summaryOf("FREE", { hadVoice: true }, { subscription: subscription({ status: "PAUSED", currentPeriodEnd: null }), hasBillingAccount: true }),
    );
    expect(page.text).toContain("Subscription paused");
    expect(page.portal).toBe(true);
    expect(page.checkouts).toEqual([]);
  });

  it("a scheduled cancellation: Pro until the date, the portal, the pack still for sale", async () => {
    const page = await renderIn(
      "en",
      summaryOf("PRO", {}, { source: "subscription", subscription: subscription({ cancelAtPeriodEnd: true, scheduledChangeAt: PERIOD_END }), hasBillingAccount: true }),
    );
    expect(page.text).toContain("Ends December 1, 2026");
    expect(page.text).toContain("Pro stays until December 1, 2026, and nothing more will be charged.");
    expect(page.checkouts).toEqual(["interview_pack"]);
    expect(page.portal).toBe(true);
  });

  it("an ended subscription: Free again, Pro on sale, the credits still usable", async () => {
    const page = await renderIn("en", summaryOf("FREE", { credits: 4, hadVoice: true }, { subscription: subscription({ status: "CANCELED" }), hasBillingAccount: true }));
    expect(page.text).toContain("Your Pro subscription ended. Nothing was deleted: everything you made is still here.");
    expect(page.checkouts).toEqual(["pro_monthly"]);
    expect(page.text).toMatch(/Interview credits\s*4/);
    expect(page.text).toContain("Each one is a full 12-minute interview, on any plan. They never expire.");
  });

  it("a comp: nothing to subscribe to or manage, unless a pack was bought", async () => {
    const comp = await renderIn("en", summaryOf("PRO"));
    expect(comp.text).toContain("There's no subscription to manage.");
    expect(comp.checkouts).toEqual(["interview_pack"]);
    expect(comp.portal).toBe(false);
    cleanup();
    expect((await renderIn("en", summaryOf("PRO", { credits: 4 }, { hasBillingAccount: true }))).portal).toBe(true);
  });

  it("while a payment is confirmed, no checkout can start, and the wait is shown", async () => {
    const page = await renderIn("en", summaryOf("FREE"), { item: "pro_monthly", transactionId: "txn_01m5jdjv22mnssacjx9vbys9cv" });
    expect(page.checkouts).toEqual([]);
    expect(page.text).toContain("Confirming your payment…");
    expect(page.container.querySelector("[data-activation-status]")).not.toBeNull();
  });

  it("shows credits held by an open interview as pending", async () => {
    const page = await renderIn("en", summaryOf("PRO", { credits: 2, pending: 1 }));
    expect(page.text).toContain("1 credit pending return");
  });

  it("says the same in Spanish", async () => {
    const page = await renderIn("es", summaryOf("PRO", {}, { source: "subscription", subscription: subscription({}), hasBillingAccount: true }));
    expect(page.text).toContain("Tienes el plan Pro.");
    expect(page.text).toContain("Se renueva el 1 de diciembre de 2026.");
    expect(page.text).toMatch(/Créditos de entrevista\s*0/);
  });
});
