import { cn } from "@/lib/utils";

const BLOCK = "block rounded-[3px] bg-ed-raise animate-pulse motion-reduce:animate-none";

/** The ledger's sections while the page loads, on the same grid so nothing jumps when the data lands. Decorative. */
export function AccountSkeleton({ sections }: { sections: number }) {
  return (
    <div aria-hidden className="mt-[clamp(8px,2vw,16px)]">
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="ed-grid gap-y-5 border-t border-ed-line py-[clamp(28px,4vw,48px)] first:border-t-0 lg:gap-y-0">
          <div className="grid content-start gap-3 lg:col-[1/span_4]">
            <span className={cn(BLOCK, "h-3 w-6")} />
            <span className={cn(BLOCK, "h-6 w-36")} />
          </div>
          <div className="grid content-start gap-3 lg:col-[5/span_8]">
            <span className={cn(BLOCK, i === 0 ? "h-16 w-40" : "h-6 w-3/5")} />
            <span className={cn(BLOCK, "h-4 w-4/5")} />
            <span className={cn(BLOCK, "h-4 w-2/5")} />
          </div>
        </div>
      ))}
    </div>
  );
}
