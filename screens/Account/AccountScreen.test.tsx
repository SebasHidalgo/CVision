// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStanding } from "@/lib/billing/access";
import type { UsageSummary } from "@/lib/database/usage";
import type { Locale, Namespace } from "@/lib/i18n/config";
import { decideEntitlement } from "@/lib/interviewEntitlement";
import { PLANS, type PlanId } from "@/lib/plans";
import AccountScreen from "./AccountScreen";

// The design system's face comes from next/font, which only runs under Next.
vi.mock("next/font/google", () => ({ Host_Grotesk: () => ({ variable: "font-text" }) }));

const request = vi.hoisted(() => ({ locale: "en" as Locale, summary: null as unknown }));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
// The screen is a server component: getT reads the real locale files, in the language the test sets.
vi.mock("@/lib/i18n/server", async () => {
  const { tFor } = await import("@/lib/i18n/testing");
  return { getT: async (ns: Namespace) => tFor(ns, request.locale), getLocale: async () => request.locale };
});
vi.mock("@/lib/database/usage", () => ({ currentUsageSummary: async () => request.summary, currentOpenSubscriptionStatus: async () => null }));
vi.mock("@/components/i18n/ClientMessages", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/i18n/LocaleMenu", () => ({ default: () => <span data-locale-menu /> }));
vi.mock("./components/SignInPanel", () => ({ default: () => <span data-sign-in-panel /> }));
vi.mock("./components/DeleteAccount", () => ({
  default: ({ subscribed, forfeitsUntil }: { subscribed: boolean; forfeitsUntil: string | null }) => (
    <span data-delete-account={String(subscribed)} data-forfeits-until={forfeitsUntil ?? "none"} />
  ),
}));

const PERIOD_END = new Date("2026-12-01T00:00:00.000Z");

type Facts = { periodUsed?: number; analysesUsed?: number; credits?: number; pending?: number; trialsUsed?: number; hadVoice?: boolean };

function summaryOf(plan: PlanId, facts: Facts = {}, standing: { source?: UsageSummary["source"]; subscription?: SubscriptionStanding | null } = {}): UsageSummary {
  const { periodUsed = 0, analysesUsed = 1, credits = 0, pending = 0, trialsUsed = 0, hadVoice = false } = facts;
  const entitlement = decideEntitlement({ plan, periodUsed, credits, trialsUsed, hadVoice, periodEnd: PERIOD_END });
  const limit = PLANS[plan].analysesPerMonth;
  return {
    plan,
    source: standing.source ?? (plan === "PRO" ? "comp" : "free"),
    analyses: { used: analysesUsed, limit, left: Math.max(0, limit - analysesUsed), announce: PLANS[plan].announceAnalyses },
    interviews: { used: periodUsed, limit: PLANS[plan].interviewsPerMonth, left: entitlement.remaining.period },
    credits: { balance: credits, pending },
    trial: { available: entitlement.remaining.trial > 0, used: trialsUsed > 0 },
    entitlement,
    period: { start: new Date("2026-11-01T00:00:00.000Z"), end: PERIOD_END },
    resetsAt: PERIOD_END,
    subscription: standing.subscription ?? null,
    everSubscribed: hadVoice,
    hasBillingAccount: false,
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

async function renderIn(locale: Locale, summary: UsageSummary) {
  request.locale = locale;
  request.summary = summary;
  const { container } = render(await AccountScreen());
  return { container, text: (container.textContent ?? "").replace(/\s+/g, " ") };
}

afterEach(cleanup);

describe("the account page", () => {
  it("shows a new Free account its analyses, its trial, and no period or credits it doesn't have", async () => {
    const { text, container } = await renderIn("en", summaryOf("FREE"));

    expect(text).toContain("Free");
    expect(text).toContain("No subscription");
    expect(text).toContain("3 analyses a month, and everything you've analyzed and rehearsed stays in your lists.");
    expect(text).toContain("Resets on December 1, 2026.");
    expect(text).toMatch(/2\s*of 3 left/);
    expect(container.querySelector('[data-cells="2/3"]')).not.toBeNull();
    expect(text).toContain("Free trial interview");
    expect(text).toContain("Available");
    expect(text).toContain("One 5-minute practice interview with the AI interviewer, once per account and email address.");
    expect(text).not.toMatch(/of 0|Interviews/);
    expect(text).not.toContain("Interview credits");
    // Free is offered Pro, and Plan & billing.
    expect(container.querySelector('a[href="/pricing"]')).not.toBeNull();
    expect(container.querySelector('a[href="/account/billing"]')).not.toBeNull();
  });

  it("tells a Free account whose trial is used, or that had Pro, why there is no trial", async () => {
    expect((await renderIn("en", summaryOf("FREE", { trialsUsed: 1 }))).text).toContain("Voice interviews are part of Pro.");
    cleanup();
    const { text } = await renderIn("en", summaryOf("FREE", { hadVoice: true }));
    expect(text).toContain("Not available");
    expect(text).toContain("The free trial is for accounts that have never had Pro or a full interview.");
  });

  it("shows a Free account the credits it holds, usable on Free", async () => {
    const { text } = await renderIn("en", summaryOf("FREE", { credits: 3, hadVoice: true }));
    expect(text).toMatch(/Interview credits\s*3/);
    expect(text).toContain("Each one is a full 12-minute interview, on any plan.");
    expect(text).toContain(`Your credits cover full interviews; Pro adds ${PLANS.PRO.interviewsPerMonth} a month.`);
    expect(text).not.toMatch(/of 0/);
  });

  it("shows Pro its period interviews and credits, and its analyses as 'up to 50', never a count", async () => {
    const { text, container } = await renderIn("en", summaryOf("PRO", { periodUsed: 1, analysesUsed: 7, hadVoice: true }));
    expect(text).toContain("Pro is granted to your account at no charge");
    expect(text).toMatch(/3\s*of 4 left/);
    expect(text).toContain("Up to 12 minutes each.");
    expect(text).toContain("Up to 50 a month");
    expect(text).not.toMatch(/43|of 50|∞/);
    expect(text).toMatch(/Interview credits\s*0/);
    expect(text).not.toContain("Free trial interview");
    expect(container.querySelector('a[href="/pricing"]')).toBeNull();
  });

  it("says when Pro's cap of analyses is reached", async () => {
    const { text } = await renderIn("en", summaryOf("PRO", { analysesUsed: 50, hadVoice: true }));
    expect(text).toContain("You've used this period's 50.");
  });

  it("states every subscription standing with its date in full", async () => {
    const cases: [UsageSummary, string, string][] = [
      [summaryOf("PRO", {}, { source: "subscription", subscription: subscription({}) }), "Active", "Renews on December 1, 2026."],
      [
        summaryOf("PRO", {}, { source: "subscription", subscription: subscription({ status: "PAST_DUE" }) }),
        "Payment failed",
        "Your last payment didn't go through and Paddle is retrying it over the next few days. Pro stays on meanwhile: update your payment method in the billing portal to keep it.",
      ],
      [
        summaryOf("PRO", {}, { source: "subscription", subscription: subscription({ cancelAtPeriodEnd: true, scheduledChangeAt: PERIOD_END }) }),
        "Ends December 1, 2026",
        "Pro ends on December 1, 2026; Free's allowance applies after that.",
      ],
      [summaryOf("FREE", { hadVoice: true }, { subscription: subscription({ status: "PAUSED", currentPeriodEnd: null }) }), "Subscription paused", "so you're on Free until you resume it."],
      [summaryOf("FREE", { hadVoice: true }, { subscription: subscription({ status: "CANCELED" }) }), "Subscription ended", "Nothing was deleted: everything you made is still here."],
    ];
    for (const [summary, label, line] of cases) {
      const { text } = await renderIn("en", summary);
      expect(text).toContain(label);
      expect(text).toContain(line);
      cleanup();
    }
  });

  it("past due: what Paddle does, with no 'Pro until' date (its retries last days, not to the period's end)", async () => {
    for (const [locale, line, date] of [
      ["en", "Paddle is retrying it over the next few days. Pro stays on meanwhile", "December 1, 2026"],
      ["es", "Paddle lo está reintentando durante los próximos días. Mientras tanto conservas Pro", "1 de diciembre de 2026"],
    ] as const) {
      const { container } = await renderIn(locale, summaryOf("PRO", {}, { source: "subscription", subscription: subscription({ status: "PAST_DUE" }) }));
      const plan = (container.querySelector('section[aria-labelledby="account-plan"]')?.textContent ?? "").replace(/\s+/g, " ");
      expect(plan, locale).toContain(line);
      expect(plan, locale).not.toContain(date);
      cleanup();
    }
  });

  it("offers Pro where a checkout can succeed: never while a paused subscription is open", async () => {
    const paused = await renderIn("en", summaryOf("FREE", { hadVoice: true }, { subscription: subscription({ status: "PAUSED", currentPeriodEnd: null }) }));
    expect(paused.container.querySelector('a[href="/pricing"]')).toBeNull();
    expect(paused.container.querySelector('a[href="/account/billing"]')).not.toBeNull();
    cleanup();
    const ended = await renderIn("en", summaryOf("FREE", { hadVoice: true }, { subscription: subscription({ status: "CANCELED" }) }));
    expect(ended.container.querySelector('a[href="/pricing"]')).not.toBeNull();
  });

  it("tells the delete control whether a subscription would be canceled with the account", async () => {
    const { container } = await renderIn("en", summaryOf("PRO", {}, { source: "subscription", subscription: subscription({}) }));
    expect(container.querySelector('[data-delete-account="true"]')).not.toBeNull();
    cleanup();
    const free = await renderIn("en", summaryOf("FREE"));
    expect(free.container.querySelector('[data-delete-account="false"]')).not.toBeNull();
    expect(free.text).toContain("Paddle, the merchant of record, keeps your invoices");
    expect(free.text).toContain("The interview conversations at ElevenLabs, our voice provider");
  });

  it("hands the delete control the end of a paid period it would cut short: renewing or canceling, not past due or a comp", async () => {
    const forfeits = async (summary: UsageSummary) => {
      const { container } = await renderIn("en", summary);
      const value = container.querySelector("[data-forfeits-until]")?.getAttribute("data-forfeits-until");
      cleanup();
      return value;
    };
    const iso = PERIOD_END.toISOString();
    expect(await forfeits(summaryOf("PRO", {}, { source: "subscription", subscription: subscription({}) }))).toBe(iso);
    expect(await forfeits(summaryOf("PRO", {}, { source: "subscription", subscription: subscription({ cancelAtPeriodEnd: true, scheduledChangeAt: PERIOD_END }) }))).toBe(iso);
    expect(await forfeits(summaryOf("PRO", {}, { source: "subscription", subscription: subscription({ status: "PAST_DUE" }) }))).toBe("none");
    expect(await forfeits(summaryOf("PRO"))).toBe("none");
    expect(await forfeits(summaryOf("FREE"))).toBe("none");
  });

  it("says the same in Spanish, dates in full", async () => {
    const { text } = await renderIn("es", summaryOf("FREE"));
    expect(text).toContain("Entrevista de prueba gratis");
    expect(text).toContain("Disponible");
    expect(text).toContain("Se reinicia el 1 de diciembre de 2026.");
    expect(text).toMatch(/2\s*de 3 disponibles/);
    expect(text).not.toMatch(/de 0|Créditos de entrevista/);
  });
});
