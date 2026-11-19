import { Bone } from "@/components/design-system/Bone";
import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { AnalysesListSkeleton } from "./components/AnalysesSkeleton";

/** Mirrors the list (the heading with its counts, the rows) so nothing jumps when the data lands. */
export default async function ResumeAnalysesLoading() {
  const t = await getT("analyses");
  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div aria-busy="true" className="wrap pt-[clamp(40px,6vw,88px)] pb-section">
        <PageHeading
          title={t("page.title")}
          ruled
          aside={
            <div className="flex gap-8">
              <Bone className="h-5 w-24" />
              <Bone className="h-5 w-32" />
            </div>
          }
        />
        <p role="status" className="sr-only">
          {t("page.loading")}
        </p>
        <AnalysesListSkeleton />
      </div>
    </div>
  );
}
