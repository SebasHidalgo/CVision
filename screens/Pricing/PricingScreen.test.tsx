// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStanding, SubscriptionStatusId } from "@/lib/billing/access";
import type { UsageSummary } from "@/lib/database/usage";
import { formatLongDate, formatMoney } from "@/lib/format";
import { LOCALES, type Locale, type Namespace } from "@/lib/i18n/config";
import { tFor } from "@/lib/i18n/testing";
import { decideEntitlement } from "@/lib/interviewEntitlement";
import { PLANS, type PlanId } from "@/lib/plans";
import PricingScreen from "./PricingScreen";

const request = vi.hoisted(() => ({
  locale: "en" as Locale,
  userId: null as string | null,
  summary: null as unknown,
  open: null as string | null,
}));

vi.mock("@/components/design-system/fonts", () => ({ fontText: { variable: "font-text", style: { fontFamily: "font-text" } } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { tFor } = await import("@/lib/i18n/testing");
  return { getT: async (ns: Namespace) => tFor(ns, request.locale), getLocale: async () => request.locale };
});
vi.mock("@/lib/auth", () => ({ getOptionalUserId: async () => request.userId }));
vi.mock("@/lib/database/usage", () => ({
  usageSummary: async () => request.summary,
  currentOpenSubscriptionStatus: async () => request.open,
}));
// The billing buttons and the sign-up are client components with their own tests: here, what the page asks of them.
vi.mock("@/components/billing/CheckoutButton", () => ({
  default: ({ item, label }: { item: string; label: string }) => (
    <button type="button" data-checkout={item}>
      {label}
    </button>
  ),
}));
vi.mock("@/components/billing/ManageSubscriptionButton", () => ({
  default: ({ label }: { label?: string }) => (
    <button type="button" data-portal>
      {label ?? "billing:portal.manage"}
    </button>
  ),
}));
vi.mock("@/components/pricing/SignUpButton", () => ({
  SignUpButton: ({ label, redirect }: { label: string; redirect: string }) => (
    <button type="button" data-sign-up={redirect}>
      {label}
    </button>
  ),
}));
vi.mock("@/components/i18n/RichText", () => ({ default: ({ i18nKey }: { i18nKey: string }) => <span data-rich={i18nKey} /> }));

const PERIOD_END = new Date("2026-12-01T00:00:00.000Z");
const CANCELS_AT = new Date("2026-12-05T00:00:00.000Z");

function subscription(status: SubscriptionStatusId, cancelAt: Date | null = null): SubscriptionStanding {
  return {
    id: "sub-row",
    providerSubscriptionId: "sub_test",
    status,
    priceKey: "pro_monthly",
    currentPeriodStart: status === "PAUSED" || status === "CANCELED" ? null : new Date("2026-11-01T00:00:00.000Z"),
    currentPeriodEnd: status === "PAUSED" || status === "CANCELED" ? null : PERIOD_END,
    cancelAtPeriodEnd: cancelAt !== null,
    scheduledChangeAt: cancelAt,
    canceledAt: status === "CANCELED" ? new Date("2026-10-30T00:00:00.000Z") : null,
    providerUpdatedAt: new Date("2026-11-02T00:00:00.000Z"),
  };
}

type Seed = {
  plan: PlanId;
  source?: UsageSummary["source"];
  subscription?: SubscriptionStanding | null;
  trialsUsed?: number;
  hadVoice?: boolean;
  credits?: number;
  billing?: boolean;
};

/** A usage summary as the ledger would report it, the entitlement decided on the same facts. */
function summaryOf({ plan, source = plan === "PRO" ? "subscription" : "free", subscription = null, trialsUsed = 0, hadVoice = false, credits = 0, billing = false }: Seed): UsageSummary {
  // A subscription, ever, is voice: no trial after it.
  const entitlement = decideEntitlement({ plan, periodUsed: 0, credits, trialsUsed, hadVoice: hadVoice || subscription !== null, periodEnd: PERIOD_END });
  return {
    plan,
    source,
    analyses: { used: 0, limit: PLANS[plan].analysesPerMonth, left: PLANS[plan].analysesPerMonth, announce: PLANS[plan].announceAnalyses },
    interviews: { used: 0, limit: PLANS[plan].interviewsPerMonth, left: entitlement.remaining.period },
    credits: { balance: credits, pending: 0 },
    trial: { available: entitlement.remaining.trial > 0, used: trialsUsed > 0 },
    entitlement,
    period: { start: new Date("2026-11-01T00:00:00.000Z"), end: PERIOD_END },
    resetsAt: PERIOD_END,
    subscription,
    everSubscribed: subscription !== null,
    hasBillingAccount: billing,
  };
}

async function renderIn(locale: Locale, seed: Seed | null) {
  request.locale = locale;
  request.userId = seed ? "user_test" : null;
  request.summary = seed ? summaryOf(seed) : null;
  request.open = seed?.subscription && seed.subscription.status !== "CANCELED" ? seed.subscription.status : null;
  const { container } = render(await PricingScreen());
  const root = container.firstElementChild as HTMLElement;
  // The table and the cards render the same actions; the table is enough to read them.
  const table = within(container.querySelector<HTMLElement>('[data-pricing-part="table"]')!);
  const cell = (plan: "free" | "pro") => within(container.querySelector<HTMLElement>(`[data-pricing-part="table"] [data-plan-action="${plan}"]`)!);
  const pack = container.querySelector<HTMLElement>('[data-pricing-part="pack"]')!;
  return { kind: root.dataset.pricingState, text: norm(container.textContent ?? ""), table, cell, pack };
}

afterEach(cleanup);

// Intl puts a no-break space in "USD 9": compare words, not space characters.
const norm = (text: string) => text.replace(/\s+/g, " ");

describe.each(LOCALES)("%s: the pricing page in every plan state", (locale) => {
  const t = tFor("pricing", locale);
  const common = tFor("common", locale);
  const price = (amount: number) => formatMoney(amount, "USD", locale);
  const date = (value: Date) => formatLongDate(value, locale);
  const proCheckout = t("pro.checkout", { price: price(15) });
  const buyPack = t("actions.buyPack", { count: 4, price: price(9) });

  it("a visitor: the plans, every figure from the plans and the catalog, and a sign-up on each", async () => {
    const page = await renderIn(locale, null);
    expect(page.kind).toBe("signed-out");
    expect(page.text).toContain(t("rows.analyses.pro", { count: 50 }));
    expect(page.text).toContain(t("rows.interviews.trial", { count: 1, minutes: 5 }));
    expect(page.text).toContain(t("rows.interviews.perMonth", { count: 4, minutes: 12 }));
    expect(page.text).toContain(norm(t("pack.lead", { count: 4, price: price(9) })));
    expect(page.cell("free").getByRole("button").dataset.signUp).toBe("/resume/upload");
    expect(page.cell("free").getByRole("button").textContent).toBe(t("free.start"));
    expect(page.cell("pro").getByRole("button").dataset.signUp).toBe("/pricing");
    expect(page.cell("pro").getByRole("button").textContent).toBe(t("pro.signUp"));
    expect(page.text).not.toContain(t("state.mark.yourPlan"));
    expect(within(page.pack).queryByRole("button")).toBeNull();
  });

  it("a new Free account: Free is its plan with the trial waiting, Pro by checkout, no pack to buy", async () => {
    const page = await renderIn(locale, { plan: "FREE" });
    expect(page.kind).toBe("free");
    expect(page.text).toContain(t("state.mark.yourPlan"));
    expect(page.text).toContain(t("state.detail.trialAvailable", { minutes: 5 }));
    expect(page.cell("free").getByRole("link").textContent).toBe(common("nav.newAnalysis"));
    expect(page.cell("pro").getByRole("button").dataset.checkout).toBe("pro_monthly");
    expect(page.cell("pro").getByRole("button").textContent).toBe(proCheckout);
    expect(within(page.pack).queryByRole("button")).toBeNull();
  });

  it("Free with the trial used is told so", async () => {
    const page = await renderIn(locale, { plan: "FREE", trialsUsed: 1 });
    expect(page.text).toContain(t("state.detail.trialUsed"));
    expect(page.text).not.toContain(t("state.detail.trialAvailable", { minutes: 5 }));
  });

  it("Free after Pro ended: nothing deleted, Pro by checkout again, and the credits it holds still count", async () => {
    const page = await renderIn(locale, { plan: "FREE", subscription: subscription("CANCELED"), credits: 2, billing: true });
    expect(page.kind).toBe("free-after-pro");
    expect(page.text).toContain(t("state.detail.afterPro"));
    expect(page.cell("pro").getByRole("button").dataset.checkout).toBe("pro_monthly");
    expect(page.text).toContain(t("pack.held", { count: 2, minutes: 12 }));
    expect(within(page.pack).queryByRole("button")).toBeNull();
  });

  it("Pro by subscription: its plan and renewal, the portal, Free included, the pack for sale", async () => {
    const page = await renderIn(locale, { plan: "PRO", subscription: subscription("ACTIVE"), billing: true });
    expect(page.kind).toBe("pro");
    expect(page.text).toContain(t("state.detail.renews", { date: date(PERIOD_END) }));
    expect(page.cell("pro").getByRole("button").dataset.portal).toBeDefined();
    expect(page.cell("free").queryByRole("button")).toBeNull();
    expect(page.cell("free").getByText(t("free.includedInPro"))).toBeTruthy();
    expect(within(page.pack).getByRole("button").textContent).toBe(buyPack);
    expect(page.table.queryByText(proCheckout)).toBeNull();
  });

  it("Pro by comp without a billing customer: no portal, the account page instead; the pack for sale", async () => {
    const page = await renderIn(locale, { plan: "PRO", source: "comp" });
    expect(page.kind).toBe("pro-comp");
    expect(page.text).toContain(t("state.detail.comp"));
    expect(page.cell("pro").queryByRole("button")).toBeNull();
    expect(page.cell("pro").getByRole("link").getAttribute("href")).toBe("/account/billing");
    expect(within(page.pack).getByRole("button").dataset.checkout).toBe("interview_pack");
  });

  it("Pro by comp with a billing customer (a pack bought): the portal, for its payments", async () => {
    const page = await renderIn(locale, { plan: "PRO", source: "comp", billing: true });
    expect(page.cell("pro").getByRole("button").textContent).toBe(t("actions.portal.payments"));
  });

  it("past due: still Pro, the portal to fix the payment, the pack still for sale", async () => {
    const page = await renderIn(locale, { plan: "PRO", subscription: subscription("PAST_DUE"), billing: true });
    expect(page.kind).toBe("past-due");
    expect(page.text).toContain(t("state.detail.pastDue"));
    expect(page.cell("pro").getByRole("button").textContent).toBe(t("actions.portal.fixPayment"));
    expect(within(page.pack).getByRole("button").textContent).toBe(buyPack);
  });

  it("canceled at period end: Pro until the date, Free from it, the portal, credits still usable", async () => {
    const page = await renderIn(locale, { plan: "PRO", subscription: subscription("ACTIVE", CANCELS_AT), billing: true, credits: 1 });
    expect(page.kind).toBe("canceling");
    expect(page.text).toContain(t("state.detail.canceling", { date: date(CANCELS_AT) }));
    expect(page.text).toContain(t("state.mark.from", { date: date(CANCELS_AT) }));
    expect(page.cell("pro").getByRole("button").dataset.portal).toBeDefined();
    expect(page.text).toContain(t("pack.held", { count: 1, minutes: 12 }));
  });

  it("paused: Free is the plan, the portal to resume, no Pro checkout and no pack", async () => {
    const page = await renderIn(locale, { plan: "FREE", subscription: subscription("PAUSED"), billing: true });
    expect(page.kind).toBe("paused");
    expect(page.text).toContain(t("state.mark.paused"));
    expect(page.text).toContain(t("state.detail.paused"));
    expect(page.cell("pro").getByRole("button").dataset.portal).toBeDefined();
    expect(page.table.queryByText(proCheckout)).toBeNull();
    expect(within(page.pack).queryByRole("button")).toBeNull();
  });
});
