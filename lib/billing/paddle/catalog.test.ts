import { BRAND } from "@/lib/brand";
import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/billing/catalog";
import { priceDiffers, productDiffers, SUBSCRIBED_EVENTS, WEBHOOK_DESCRIPTION } from "./catalog";

describe("the catalog sync's decisions", () => {
  it("leaves a product alone when name, description and tax category match, and updates otherwise", () => {
    const wanted = CATALOG.pro_monthly;
    const asIs = { name: wanted.name, description: wanted.description, taxCategory: "saas" as const };
    expect(productDiffers(asIs, wanted)).toBe(false);
    expect(productDiffers({ ...asIs, description: "old words" }, wanted)).toBe(true);
    expect(productDiffers({ ...asIs, taxCategory: "standard" }, wanted)).toBe(true);
  });

  it("compares a price on amount, currency, cycle and quantity", () => {
    const body = {
      description: "CVision Pro, monthly",
      unitPrice: { amount: "1500", currencyCode: "USD" },
      billingCycle: { interval: "month", frequency: 1 },
      quantity: { minimum: 1, maximum: 1 },
    };
    const asIs = {
      description: body.description,
      unitPrice: { amount: "1500", currencyCode: "USD" as const },
      billingCycle: { interval: "month" as const, frequency: 1 },
      quantity: { minimum: 1, maximum: 1 },
    };
    expect(priceDiffers(asIs, body)).toBe(false);
    expect(priceDiffers({ ...asIs, unitPrice: { amount: "1200", currencyCode: "USD" } }, body)).toBe(true);
    expect(priceDiffers({ ...asIs, billingCycle: null }, body)).toBe(true);
    expect(priceDiffers({ ...asIs, billingCycle: { interval: "year", frequency: 1 } }, body)).toBe(true);
    expect(priceDiffers({ ...asIs, quantity: { minimum: 1, maximum: 100 } }, body)).toBe(true);
    // A one-time price has no cycle on either side.
    expect(priceDiffers({ ...asIs, billingCycle: null }, { ...body, billingCycle: null })).toBe(false);
  });

  it("subscribes the destination to exactly the events the webhook applies", () => {
    expect([...SUBSCRIBED_EVENTS].sort()).toEqual(
      [
        "adjustment.created",
        "adjustment.updated",
        "subscription.activated",
        "subscription.canceled",
        "subscription.created",
        "subscription.past_due",
        "subscription.paused",
        "subscription.resumed",
        "subscription.trialing",
        "subscription.updated",
        "transaction.completed",
      ].sort(),
    );
    expect(WEBHOOK_DESCRIPTION).toBe(BRAND.name);
  });

  it("describes the product as a self-assessment and practice tool, never as screening, coaching or a person", () => {
    for (const product of Object.values(CATALOG)) {
      const text = `${product.name} ${product.description}`.toLowerCase();
      expect(text).toMatch(/self-assessment|practice|your own cv/);
      expect(text).not.toMatch(/screen|evaluat|hiring|coach|exam|recruiter|employer|real person|human/);
      expect(text).toMatch(/ai (voice )?interviewer/);
    }
    expect(CATALOG.pro_monthly.amountMinor).toBe("1500");
    expect(CATALOG.interview_pack.amountMinor).toBe("900");
    // The pack: four interviews for the same nine dollars, said in the name and the description, and the grant size beside them.
    expect(CATALOG.interview_pack.credits).toBe(4);
    expect(CATALOG.interview_pack.name).toContain("4 interviews");
    expect(CATALOG.interview_pack.description).toContain("4 voice interviews, up to 12 minutes each");
    expect(CATALOG.pro_monthly.credits).toBeUndefined();
  });
});
