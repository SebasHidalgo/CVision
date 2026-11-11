import PageIntro from "@/components/layout/PageIntro";
import { getT } from "@/lib/i18n/server";
import { AnalysesListSkeleton } from "./components/AnalysesSkeleton";

export default async function ResumeAnalysesLoading() {
  const t = await getT("analysis");
  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro eyebrow={t("list.eyebrow")} title={t("list.title")} />
      <AnalysesListSkeleton />
    </div>
  );
}
