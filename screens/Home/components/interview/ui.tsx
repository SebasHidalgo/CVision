import { cn } from "@/lib/utils";

// The replicas' shared pieces: the app's eyebrow (12 px caps) and its tick, its display size and its meters, drawn in
// the landing's tokens. Colour stays ink: green is kept for what a CV proves.

/** The eyebrow; add a colour. */
export const CAP = "text-ed-cap font-semibold uppercase";
/** A short rule before the eyebrow. */
export const TICK = "inline-flex items-center gap-2 before:h-px before:w-3.5 before:bg-current before:content-['']";
export const DISPLAY_MD = "font-ed-display text-[clamp(22px,2.1vw,28px)] font-normal leading-[1.15] tracking-[-0.02em] text-balance text-ed-ink";
export const THIN_SCROLL = "[scrollbar-width:thin] [scrollbar-color:var(--color-ed-line-2)_transparent]";
/** The report's numbered rows: an ordinal column, then the row. */
export const ROWS = "mt-[18px] border-t border-ed-line";
export const ROW = "grid grid-cols-[2.6rem_minmax(0,1fr)] gap-3.5 border-b border-ed-line py-[18px]";

/** A score bar the way the app reads it: a meter from 0 to 100. */
export function Meter({ value, label, size = "sm" }: { value: number; label: string; size?: "sm" | "lg" }) {
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn("block overflow-hidden rounded-[2px] bg-ed-line", size === "lg" ? "h-1.5" : "h-1")}
    >
      <span className="block h-full bg-ed-ink" style={{ width: `${value}%` }} />
    </span>
  );
}
