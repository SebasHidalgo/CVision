"use client";

import { Surface } from "@/components/design-system/Surface";
import { cn } from "@/lib/utils";
import { PlanAction } from "./PlanAction";
import { PlanName, PlanPrice } from "./PlanHead";
import type { Pricing } from "./usePricing";

/** The same comparison on a phone: one plan after the other, each with its own button. */
export function PlanStack({ pricing, className }: { pricing: Pricing; className?: string }) {
  const { rows, plans } = pricing;
  return (
    <div className={cn("grid gap-7", className)}>
      {(["free", "pro"] as const).map((id) => (
        <Surface key={id} as="section" aria-labelledby={`plan-${id}-name`} className="grid gap-2.5 p-4">
          <div>
            <PlanName as="h3" id={`plan-${id}-name`}>
              {plans[id].name}
            </PlanName>
            <PlanPrice price={plans[id].price} cadence={plans[id].cadence} />
          </div>
          <dl>
            {rows.map((row) => (
              <div key={row.id} className="grid gap-0.5 border-b border-ed-line py-2.5">
                <dt className="text-[13.5px] text-ed-ink-3">{row.label}</dt>
                <dd className="text-ed-ink-2">{row[id]}</dd>
              </div>
            ))}
          </dl>
          <PlanAction plan={id} className="mt-1.5 justify-self-start" />
        </Surface>
      ))}
    </div>
  );
}
