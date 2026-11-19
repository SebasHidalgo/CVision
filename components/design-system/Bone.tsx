import { cn } from "@/lib/utils";

/**
 * A loading skeleton's block: a quiet shape in the divider tone (visible on the page and on a surface) that breathes
 * only when motion is allowed. Decorative: the page that shows bones also says "Loading" in words, in a status line.
 * Size and shape come from `className`.
 */
export function Bone({ className }: { className?: string }) {
  return <span aria-hidden data-bone="" className={cn("block rounded-[3px] bg-line motion-safe:animate-pulse", className)} />;
}
