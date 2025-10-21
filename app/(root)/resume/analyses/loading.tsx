import {
  ReviewsGridSkeleton,
  ReviewsStatsSkeleton,
} from "@/components/skeletons/AnalysesSkeleton";

export default function loading() {
  return (
    <section className="container mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2 text-balance">
          Your Resume Reviews
        </h1>
        <p className="text-muted-foreground text-lg">
          View and manage all your resume analysis results
        </p>
      </div>
      <ReviewsStatsSkeleton />
      <ReviewsGridSkeleton />
    </section>
  );
}
