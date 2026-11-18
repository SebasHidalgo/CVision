import { fontText } from "@/components/design-system/fonts";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { AnalysesListSkeleton } from "./components/AnalysesSkeleton";
import { PageHeading } from "./components/PageHeading";

export default async function ResumeAnalysesLoading() {
  const t = await getT("analyses");
  return (
    <div className={cn("ed-root flex-1", fontText.variable)}>
      <div className="ed-wrap pt-[clamp(40px,6vw,88px)] pb-ed-section">
        <PageHeading id="analyses-title" title={t("page.title")} />
        <p role="status" className="sr-only">
          {t("page.loading")}
        </p>
        <AnalysesListSkeleton />
      </div>
    </div>
  );
}
