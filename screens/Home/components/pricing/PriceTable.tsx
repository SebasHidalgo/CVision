"use client";

import { useTranslation } from "react-i18next";
import { Surface } from "@/components/design-system/Surface";
import { cn } from "@/lib/utils";
import { PlanAction } from "./PlanAction";
import { PlanName, PlanPrice } from "./PlanHead";
import type { Pricing } from "./usePricing";

const CELL = "border-b py-4 pr-4 text-left align-top font-normal";

/** Free and Pro side by side, from 640 px. The first column takes four of the twelve grid columns. */
export function PriceTable({ pricing, className }: { pricing: Pricing; className?: string }) {
  const { t } = useTranslation("landingPricing");
  const { rows, plans } = pricing;
  return (
    <Surface className={cn("px-6 pt-2 pb-5", className)}>
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{t("plansLabel")}</caption>
        <colgroup>
          <col className="w-[calc((100%_-_11*var(--spacing-ed-gutter))/3_+_4*var(--spacing-ed-gutter))]" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <td className={cn(CELL, "border-ed-line-2 pb-5")} />
            {(["free", "pro"] as const).map((id) => (
              <th key={id} scope="col" className={cn(CELL, "border-ed-line-2 pb-5")}>
                <PlanName>{plans[id].name}</PlanName>
                <PlanPrice price={plans[id].price} cadence={plans[id].cadence} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className={cn(CELL, "border-ed-line text-[14px] text-ed-ink-3")}>
                {row.label}
              </th>
              <td className={cn(CELL, "border-ed-line text-ed-ink-2")}>{row.free}</td>
              <td className={cn(CELL, "border-ed-line text-ed-ink-2")}>{row.pro}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="pt-[22px] pr-4 text-left">
              <span className="sr-only">{t("cta.rowLabel")}</span>
            </th>
            <td className="pt-[22px] pr-4">
              <PlanAction plan="free" />
            </td>
            <td className="pt-[22px] pr-4">
              <PlanAction plan="pro" />
            </td>
          </tr>
        </tbody>
      </table>
    </Surface>
  );
}
