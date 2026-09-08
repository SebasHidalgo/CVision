import { Skeleton } from "@/components/ui/skeleton";

const ROWS = [0, 1, 2, 3];

/** Mirrors IndexRow's grid so the list doesn't jump when data lands. */
export function AnalysesListSkeleton() {
  return (
    <ol className="divide-y divide-line border-b border-line" aria-hidden>
      {ROWS.map((row) => (
        <li
          key={row}
          className="grid grid-cols-[2.25rem_1fr_1.5rem] gap-x-4 gap-y-4 py-5 md:grid-cols-[3rem_1fr_8.5rem_15rem_2rem] md:items-center md:gap-x-6 md:py-6"
        >
          <Skeleton className="h-3 w-6" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
          <Skeleton className="size-4 justify-self-end md:order-last" />
          <Skeleton className="col-span-2 col-start-2 h-3 w-24 md:col-span-1 md:col-start-auto md:order-3" />
          <div className="col-span-2 col-start-2 flex items-center gap-4 md:col-span-1 md:col-start-auto md:order-4">
            <Skeleton className="h-7 w-10" />
            <Skeleton className="h-2.5 flex-1" />
          </div>
        </li>
      ))}
    </ol>
  );
}
