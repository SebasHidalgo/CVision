import { cn } from "@/lib/utils";

/** A plan's name, set in the display face. */
export function PlanName({ children, as: Tag = "span", id }: { children: string; as?: "span" | "h3"; id?: string }) {
  return (
    <Tag id={id} className="block font-ed-display text-[32px] leading-[1.1] font-normal tracking-[-0.02em] text-ed-ink [font-variation-settings:'opsz'_72,'SOFT'_0,'WONK'_0]">
      {children}
    </Tag>
  );
}

/** "USD 15 al mes" / "$15 a month": the amount in mono, the cadence beside it. */
export function PlanPrice({ price, cadence, className }: { price: string; cadence: string | null; className?: string }) {
  return (
    <span className={cn("mt-1.5 block text-ed-ink-2", className)}>
      <span className="ed-mono text-[20px] text-ed-ink">{price}</span>
      {cadence && <> {cadence}</>}
    </span>
  );
}
