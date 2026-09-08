import PageIntro from "@/components/layout/PageIntro";
import { Skeleton } from "@/components/ui/skeleton";

const ROWS = [0, 1, 2];

export default function InterviewsLoading() {
  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro eyebrow="Your interviews" title="Every rehearsal, on the record." />
      <ol className="divide-y divide-line border-b border-line" aria-hidden>
        {ROWS.map((row) => (
          <li
            key={row}
            className="grid grid-cols-[2.25rem_1fr_1.5rem] gap-x-4 gap-y-4 py-5 md:grid-cols-[3rem_1fr_8.5rem_15rem_2rem] md:items-center md:gap-x-6 md:py-6"
          >
            <Skeleton className="h-3 w-6" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
            <Skeleton className="size-4 justify-self-end md:order-last" />
            <Skeleton className="col-span-2 col-start-2 h-3 w-24 md:col-span-1 md:col-start-auto md:order-3" />
            <Skeleton className="col-span-2 col-start-2 h-4 w-36 md:col-span-1 md:col-start-auto md:order-4" />
          </li>
        ))}
      </ol>
    </div>
  );
}
