import { cn } from "@/lib/utils";

/** Filled: in force or available. Half: in force but ending or at risk. Empty: none, or used. Dashed: not for this account. */
export type MarkShape = "filled" | "half" | "empty" | "dashed";

// Shape carries the meaning without colour, and it is ink: the signal green marks only what a CV proves.
const SHAPE: Record<MarkShape, string> = {
  filled: "border-ed-ink bg-ed-ink",
  half: "border-ed-ink bg-[linear-gradient(to_top,var(--color-ed-ink)_50%,transparent_50%)]",
  empty: "border-ed-ink-2",
  dashed: "border-dashed border-ed-ink-2",
};

/** The account pages' state square. Decorative: the state is always written next to it. */
export function Mark({ shape, className }: { shape: MarkShape; className?: string }) {
  return <span aria-hidden data-mark={shape} className={cn("inline-block size-[11px] flex-none border-[1.5px]", SHAPE[shape], className)} />;
}
