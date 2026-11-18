import { cn } from "@/lib/utils";

export type MarkStatus = "met" | "partial" | "missing" | "notshown";

// Shape carries the status without colour: filled, half, empty, dashed.
const SHAPE: Record<MarkStatus, string> = {
  met: "border-ed-signal bg-ed-signal",
  partial: "border-ed-signal bg-[linear-gradient(to_top,var(--color-ed-signal)_50%,transparent_50%)]",
  missing: "border-ed-ink-3",
  notshown: "border-dashed border-ed-ink-2",
};

/** The requirement status square. Decorative: the status is always written next to it. */
export function StatusMark({
  status,
  className,
  ...rest
}: { status: MarkStatus; className?: string } & Omit<React.ComponentPropsWithoutRef<"span">, "className" | "children">) {
  return (
    <span
      aria-hidden
      data-status={status}
      className={cn("inline-block size-[11px] flex-none border-[1.5px]", SHAPE[status], className)}
      {...rest}
    />
  );
}
