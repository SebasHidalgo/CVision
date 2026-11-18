"use client";

import { useTranslation } from "react-i18next";
import { Surface } from "@/components/design-system/Surface";
import type { Pricing } from "./usePricing";

/** The interview pack: bought with Pro active, usable on any plan, never expiring (CLAUDE.md, M6-B). */
export function PackAddon({ pack }: { pack: Pricing["pack"] }) {
  const { t } = useTranslation("landingPricing");
  return (
    <Surface className="ed-grid mt-7 items-baseline gap-y-1.5 px-6 py-4 max-sm:px-4">
      <p className="ed-cap lg:col-[1/span_4]">{t("pack.label")}</p>
      <p className="text-ed-ink-2 lg:col-[5/span_8]">
        <strong className="font-semibold text-ed-ink">{t("pack.lead", { count: pack.credits, price: pack.price })}</strong>{" "}
        {t("pack.body")}
      </p>
    </Surface>
  );
}
