// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageSummary } from "@/lib/database/usage";
import type { Locale, Namespace } from "@/lib/i18n/config";
import { decideEntitlement } from "@/lib/interviewEntitlement";
import { PLANS, type PlanId } from "@/lib/plans";
import AccountBillingScreen from "./AccountBillingScreen";

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
}));
vi.mock("@/components/billing/CheckoutButton", () => ({ default: ({ label }: { label: string }) => <button type="button">{label}</button> }));
vi.mock("@/components/billing/ManageSubscriptionButton", () => ({ default: () => null }));
vi.mock("@/components/i18n/ClientMessages", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/i18n/LocaleMenu", () => ({ default: () => null }));
vi.mock("./components/BillingActivation", () => ({ default: () => null }));

const PERIOD_END = new Date("2026-12-01T00:00:00.000Z");

/** A summary as the ledger would report it, the entitlement decided on the same facts. */
function summaryOf(plan: PlanId, facts: { periodUsed?: number; credits?: number; trialsUsed?: number; hadVoice?: boolean }): UsageSummary {
  const { periodUsed = 0, credits = 0, trialsUsed = 0, hadVoice = false } = facts;
  const entitlement = decideEntitlement({ plan, periodUsed, credits, trialsUsed, hadVoice, periodEnd: PERIOD_END });
  return {
    plan,
    source: plan === "PRO" ? "comp" : "free",
    analyses: { used: 1, limit: PLANS[plan].analysesPerMonth, left: PLANS[plan].analysesPerMonth - 1, announce: PLANS[plan].announceAnalyses },
    interviews: { used: periodUsed, limit: PLANS[plan].interviewsPerMonth, left: entitlement.remaining.period },
    credits: { balance: credits, pending: 0 },
    trial: { available: entitlement.remaining.trial > 0, used: trialsUsed > 0 },
    entitlement,
    period: { start: new Date("2026-11-01T00:00:00.000Z"), end: PERIOD_END },
    resetsAt: PERIOD_END,
    subscription: null,
    everSubscribed: hadVoice,
    hasBillingAccount: false,
  };
}

async function renderIn(locale: Locale, summary: UsageSummary) {
  request.locale = locale;
  request.summary = summary;
  const { container } = render(await AccountBillingScreen({ activation: null }));
  return container.textContent ?? "";
}

afterEach(cleanup);

describe("the account page's interview standing", () => {
  it("shows a new Free account its trial, and no period or credits it doesn't have", async () => {
    const text = await renderIn("en", summaryOf("FREE", {}));

    expect(text).toContain("Free trial interview");
    expect(text).toContain("Available");
    expect(text).toContain("One 5-minute practice interview with the AI interviewer, once per account.");
    expect(text).not.toMatch(/Interviews this period|of 0/);
    expect(text).not.toContain("Interview credits");
  });

  it("tells a Free account whose trial is used that interviews are part of Pro", async () => {
    const text = await renderIn("en", summaryOf("FREE", { trialsUsed: 1 }));

    expect(text).toContain("Used");
    expect(text).toContain("Voice interviews are part of Pro.");
    expect(text).not.toMatch(/Interviews this period|of 0/);
  });

  it("tells a Free account that had Pro why it has no trial", async () => {
    const text = await renderIn("en", summaryOf("FREE", { hadVoice: true }));

    expect(text).toContain("Not available");
    expect(text).toContain("The free trial is for accounts that have never had Pro or a full interview.");
  });

  it("shows a Free account the credits it holds, usable on Free", async () => {
    const text = await renderIn("en", summaryOf("FREE", { credits: 3, hadVoice: true }));

    expect(text).toContain("Interview credits");
    expect(text).toContain("Each one is a full 12-minute interview, on any plan.");
    expect(text).toContain(`Your credits cover full interviews; Pro adds ${PLANS.PRO.interviewsPerMonth} a month.`);
    expect(text).not.toMatch(/Interviews this period|of 0/);
  });

  it("keeps Pro's period line and its credits, even at zero", async () => {
    const text = await renderIn("en", summaryOf("PRO", { periodUsed: 1, hadVoice: true }));

    expect(text).toContain("Interviews this period");
    expect(text).toMatch(new RegExp(`3\\s*of ${PLANS.PRO.interviewsPerMonth}`));
    expect(text).toContain("Resets");
    expect(text).toContain("Interview credits");
    expect(text).not.toContain("Free trial interview");
  });

  it("says the same in Spanish", async () => {
    const text = await renderIn("es", summaryOf("FREE", {}));

    expect(text).toContain("Entrevista de prueba gratis");
    expect(text).toContain("Disponible");
    expect(text).not.toMatch(/Entrevistas de este período|de 0/);
    expect(text).not.toContain("Créditos de entrevista");
  });
});
