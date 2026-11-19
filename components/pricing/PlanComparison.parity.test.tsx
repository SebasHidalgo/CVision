// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALES, type Locale, type Namespace } from "@/lib/i18n/config";
import { tFor } from "@/lib/i18n/testing";
import { PricingSection } from "@/screens/Home/components/pricing/PricingSection";
import PricingScreen from "@/screens/Pricing/PricingScreen";
import { PlanComparison } from "./PlanComparison";
import { PLAN_KEYS, pricingView } from "./pricingView";

// The landing says its plans are the pricing page's: the same components, fed the same view, not a copy that drifts.

const request = vi.hoisted(() => ({ locale: "en" as Locale }));

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
// A visitor on both pages.
vi.mock("@/lib/auth", () => ({ getOptionalUserId: async () => null }));
vi.mock("@/lib/database/usage", () => ({ usageSummary: async () => null, currentOpenSubscriptionStatus: async () => null }));
vi.mock("@clerk/nextjs", () => ({
  SignedOut: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedIn: () => null,
}));
vi.mock("@/components/auth/SignInCta", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/i18n/RichText", async () => {
  const { tFor } = await import("@/lib/i18n/testing");
  return { default: ({ ns, i18nKey, values }: { ns: Namespace; i18nKey: string; values?: Record<string, unknown> }) => <>{tFor(ns, request.locale)(i18nKey as never, values as never)}</> };
});

/** Every part in document order, with what makes it what it is (the row, the plan, the standing's tone). */
const signature = (root: Element) =>
  [...root.querySelectorAll("[data-pricing-part]")].map((el) =>
    [el.getAttribute("data-pricing-part"), el.getAttribute("data-row"), el.getAttribute("data-plan-action")].filter(Boolean).join(":"),
  );

/** The words a reader compares on: plan heads, rows, the pack, the note; never the actions, which each page decides. */
function words(root: Element) {
  const copy = root.cloneNode(true) as Element;
  copy.querySelectorAll("[data-plan-action]").forEach((el) => el.replaceChildren());
  return [...copy.querySelectorAll('[data-pricing-part="plans"], [data-pricing-part="pack"] p, [data-pricing-part="note"]')].map((el) => el.textContent?.replace(/\s+/g, " ").trim());
}

afterEach(cleanup);

describe.each(LOCALES)("%s: the landing's plans and the pricing page's", (locale) => {
  it("render the same parts, in the same order, with the same words", async () => {
    request.locale = locale;
    const landing = render(await PricingSection()).container;
    const page = render(await PricingScreen()).container;

    expect(signature(landing).length).toBeGreaterThan(10);
    expect(signature(landing)).toEqual(signature(page));
    expect(words(landing)).toEqual(words(page));
  });

  it("the wide table and the narrow cards carry the same rows, standing and actions", () => {
    const view = pricingView({ t: tFor("pricing", locale), common: tFor("common", locale), locale });
    const html = renderToStaticMarkup(
      <PlanComparison
        view={view}
        actions={{ free: <a href="/resume/upload">free</a>, pro: <button type="button">pro</button> }}
        standing={{ free: { tone: "current", label: "now", detail: "detail" }, pro: { tone: "note", label: "note", detail: null } }}
      />,
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    const table = root.querySelector('[data-pricing-part="table"]')!;
    const cards = root.querySelector('[data-pricing-part="cards"]')!;
    const rows = (el: Element) => [...el.querySelectorAll('[data-pricing-part="row"]')].map((row) => row.getAttribute("data-row"));
    expect(rows(cards)).toEqual([...rows(table), ...rows(table)]);
    expect(table.querySelectorAll('[data-pricing-part="standing"]')).toHaveLength(2);
    expect(cards.querySelectorAll('[data-pricing-part="standing"]')).toHaveLength(2);
    for (const el of [table, cards]) {
      expect(el.querySelector('[data-plan-action="free"] a')?.getAttribute("href")).toBe("/resume/upload");
      expect(el.querySelector('[data-plan-action="pro"] button')?.textContent).toBe("pro");
      // The reader's plan is marked by shape: one current column or card.
      expect(el.querySelectorAll('[data-current="true"]')).toHaveLength(1);
      expect(el.querySelector('[data-current="true"]')?.getAttribute("data-plan")).toBe("free");
    }
    // Every figure is the plans' and the catalog's.
    expect(table.textContent).toContain(tFor("pricing", locale)("rows.analyses.pro", { count: 50 }));
  });

  it("names each plan with a heading in both layouts, at the page's level: 2 on /pricing, 3 in the landing's section", async () => {
    request.locale = locale;
    const { plans } = pricingView({ t: tFor("pricing", locale), common: tFor("common", locale), locale });
    const names = PLAN_KEYS.map((key) => plans[key].name);
    for (const [renderPage, level] of [
      [PricingScreen, 2],
      [PricingSection, 3],
    ] as const) {
      const root = render(await renderPage()).container;
      // The table's column headers keep their role; HTML keeps an <hN> out of a <th>, so the heading is an ARIA one.
      const columns = [...root.querySelectorAll('[data-pricing-part="table"] th[scope="col"]')];
      expect(columns.map((th) => th.querySelector('[role="heading"]')?.getAttribute("aria-level"))).toEqual([String(level), String(level)]);
      expect(columns.map((th) => th.querySelector('[role="heading"]')?.textContent)).toEqual(names);
      expect(root.querySelectorAll('[data-pricing-part="table"] h1, [data-pricing-part="table"] h2, [data-pricing-part="table"] h3')).toHaveLength(0);
      expect([...root.querySelectorAll(`[data-pricing-part="cards"] h${level}`)].map((h) => h.textContent)).toEqual(names);
      cleanup();
    }
  });
});
