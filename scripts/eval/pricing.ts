/**
 * What an eval call costs, per model and serving tier, in USD per million
 * tokens. The one place prices live: the spend ledger, the pre-run estimate
 * and the caps all read it. Output includes thinking tokens.
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing (read 2026-11-10).
 * Flex: https://ai.google.dev/gemini-api/docs/flex-inference (preview,
 * synchronous, 50% of standard, no free tier). The free tier costs nothing
 * but Google may use what it is sent: only invented data goes there.
 */
export type Tier = "standard" | "flex" | "free";

export type Price = { inputPerMillion: number; outputPerMillion: number };

export const PRICES: Record<string, Record<Tier, Price>> = {
  "gemini-3.5-flash-lite": {
    standard: { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    flex: { inputPerMillion: 0.15, outputPerMillion: 1.25 },
    free: { inputPerMillion: 0, outputPerMillion: 0 },
  },
};

// Batch is priced like Flex but asynchronous (hours); the harness does not use it.
export const BATCH_PRICE_NOTE = "batch: same as flex, asynchronous, unused";

/** The price of a model at a tier; an unknown model is priced at the dearest known standard rate. */
export function priceOf(model: string | null, tier: Tier): Price {
  const known = model ? PRICES[model] : undefined;
  if (known) return known[tier];
  if (tier === "free") return { inputPerMillion: 0, outputPerMillion: 0 };
  const dearest = Object.values(PRICES).reduce((worst, prices) =>
    prices.standard.outputPerMillion > worst.standard.outputPerMillion ? prices : worst,
  );
  return dearest[tier];
}

export function costOf(model: string | null, tier: Tier, input: number, output: number): number {
  const price = priceOf(model, tier);
  return (input * price.inputPerMillion + output * price.outputPerMillion) / 1_000_000;
}
