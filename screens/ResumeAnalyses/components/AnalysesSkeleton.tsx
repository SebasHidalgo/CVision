import { Bone } from "@/components/design-system/Bone";
import { Surface } from "@/components/design-system/Surface";
import { ROW_GRID } from "./AnalysisRow";

const ROWS = [0, 1, 2];

/** Mirrors AnalysisRow's grid so the ledger doesn't jump when the data lands. Decorative: the page announces loading. */
export function AnalysesListSkeleton() {
  return (
    <Surface as="ol" aria-hidden className="mt-10 divide-y divide-ed-line overflow-hidden">
      {ROWS.map((row) => (
        <li key={row} className={ROW_GRID}>
          <Bone className="mt-1 h-3 w-5 [grid-area:n]" />
          <div className="grid gap-2.5 [grid-area:title]">
            <Bone className="h-3 w-24" />
            <Bone className="h-5 w-3/5" />
            <Bone className="h-4 w-2/5" />
          </div>
          <div className="grid gap-3 [grid-area:fit]">
            <Bone className="h-6 w-28" />
            <Bone className="h-3 w-36" />
            <Bone className="h-3 w-4/5" />
          </div>
          <div className="grid gap-2.5 [grid-area:int]">
            <Bone className="h-3 w-20" />
            <Bone className="h-4 w-32" />
          </div>
        </li>
      ))}
    </Surface>
  );
}
