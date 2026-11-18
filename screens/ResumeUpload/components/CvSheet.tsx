import { cn } from "@/lib/utils";

/** The CV as an object: a small sheet with a heading bar, text lines and a folded corner. Decorative. */
export default function CvSheet({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("relative block h-14 w-11 shrink-0 rounded-[3px] border border-ed-line-2 bg-ed-sheet px-2 pt-2.5", className)}
    >
      <span className="block h-1 w-1/2 bg-ed-ink-2" />
      <span className="mt-1.5 block h-px w-full bg-ed-line-2" />
      <span className="mt-1 block h-px w-4/5 bg-ed-line-2" />
      <span className="mt-1 block h-px w-full bg-ed-line-2" />
      <span className="mt-1 block h-px w-3/5 bg-ed-line-2" />
      <span className="absolute top-0 right-0 size-3 bg-ed-line-2 [clip-path:polygon(0_0,100%_100%,0_100%)]" />
    </span>
  );
}
