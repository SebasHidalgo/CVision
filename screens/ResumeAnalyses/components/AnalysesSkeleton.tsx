import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ReviewsStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
      {[1, 2].map((i) => (
        <Card key={i} className="p-6 bg-card/50 backdrop-blur border-border/40">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function ReviewCardSkeleton() {
  return (
    <Card className="overflow-hidden py-0 bg-card/50 backdrop-blur border-border/40 h-full">
      {/* Resume Thumbnail Skeleton */}
      <Skeleton className="aspect-[3/3] rounded-xl p-1" />

      {/* Review Info Skeleton */}
      <div className="p-5 space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>

        <Skeleton className="h-4 w-32" />

        {/* Score Indicator Skeleton */}
        <div className="flex items-center gap-2">
          <Skeleton className="flex-1 h-2 rounded-full" />
          <Skeleton className="h-4 w-12" />
        </div>
      </div>
    </Card>
  );
}

export function ReviewsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {[1, 2, 3].map((i) => (
        <ReviewCardSkeleton key={i} />
      ))}
    </div>
  );
}
