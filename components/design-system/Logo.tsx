import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** The wordmark: the name in the display face and the ink square. The signal colour is kept for proof. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-end gap-[3px] leading-none", className)}>
      <span className="font-ed-display text-[23px] font-medium tracking-[-0.02em] [font-variation-settings:'opsz'_48,'SOFT'_0,'WONK'_0]">
        {BRAND.name}
      </span>
      <span aria-hidden data-logo-mark className="mb-[3px] size-[7px] bg-ed-ink" />
    </span>
  );
}
