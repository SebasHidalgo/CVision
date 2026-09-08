import { Skeleton } from "@/components/ui/skeleton";

const SECTIONS = [0, 1, 2];

/** Same bones as the report so the page settles instead of jumping. */
export default function ResumeAnalysisDetailLoading() {
  return (
    <div className="wrap py-10 lg:py-14" aria-busy aria-label="Loading analysis">
      <header className="border-b border-line pb-10 lg:pb-12">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="space-y-5 lg:col-span-7">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-12 w-3/4 max-w-md" />
          </div>
          <div className="flex items-end gap-4 lg:col-span-5 lg:justify-self-end">
            <Skeleton className="h-24 w-32" />
            <Skeleton className="mb-2 h-4 w-20" />
          </div>
        </div>
        <Skeleton className="mt-8 h-8 w-full" />
        <div className="mt-10 grid gap-8 lg:grid-cols-12">
          <div className="space-y-2.5 lg:col-span-8">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="flex gap-3 lg:col-span-4 lg:justify-end">
            <Skeleton className="h-11 w-28" />
            <Skeleton className="h-11 w-48" />
          </div>
        </div>
      </header>

      <div className="space-y-12 py-10 lg:py-14">
        {SECTIONS.map((section) => (
          <div key={section} className="grid gap-4 sm:grid-cols-[3rem_1fr_auto] sm:gap-6">
            <Skeleton className="h-3 w-6" />
            <div className="space-y-2.5">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
