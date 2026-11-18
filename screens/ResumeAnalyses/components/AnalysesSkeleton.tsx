import { Surface } from "@/components/design-system/Surface";
import { cn } from "@/lib/utils";
import { ROW_GRID } from "./AnalysisRow";

const ROWS = [0, 1, 2];
const BLOCK = "rounded-[3px] bg-ed-raise animate-pulse motion-reduce:animate-none";

/** Mirrors AnalysisRow's grid so the ledger doesn't jump when the data lands. Decorative: the page announces loading. */
export function AnalysesListSkeleton() {
  return (
    <Surface as="ol" aria-hidden className="mt-10 divide-y divide-ed-line overflow-hidden">
      {ROWS.map((row) => (
        <li key={row} className={ROW_GRID}>
          <span className={cn(BLOCK, "mt-1 h-3 w-5 [grid-area:n]")} />
          <div className="grid gap-2.5 [grid-area:title]">
            <span className={cn(BLOCK, "h-3 w-24")} />
            <span className={cn(BLOCK, "h-5 w-3/5")} />
            <span className={cn(BLOCK, "h-4 w-2/5")} />
          </div>
          <div className="grid gap-3 [grid-area:fit]">
            <span className={cn(BLOCK, "h-6 w-28")} />
            <span className={cn(BLOCK, "h-3 w-36")} />
            <span className={cn(BLOCK, "h-3 w-4/5")} />
          </div>
          <div className="grid gap-2.5 [grid-area:int]">
            <span className={cn(BLOCK, "h-3 w-20")} />
            <span className={cn(BLOCK, "h-4 w-32")} />
          </div>
        </li>
      ))}
    </Surface>
  );
}
