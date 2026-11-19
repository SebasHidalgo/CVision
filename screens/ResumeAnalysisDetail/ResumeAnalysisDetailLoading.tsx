import { Bone } from "@/components/design-system/Bone";
import { fontText } from "@/components/design-system/fonts";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const SECTIONS = [0, 1, 2];
const ROWS = [0, 1, 2, 3];

/** Same bones as the report (cover and verdict card, fixes, sections with the index) so the page settles instead of jumping. */
export default async function ResumeAnalysisDetailLoading() {
  const t = await getT("analysis");
  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div aria-busy="true" className="wrap pt-[clamp(32px,5vw,64px)] pb-section">
        <p role="status" className="sr-only">
          {t("detail.loading")}
        </p>

        <div className="page-grid gap-y-8 lg:grid-rows-[auto_1fr] lg:gap-y-10">
          <div className="grid gap-4 lg:col-[1/span_8] lg:row-start-1">
            <Bone className="h-3 w-44" />
            <Bone className="mt-3 h-5 w-36" />
            <Bone className="h-14 w-4/5 max-w-xl" />
          </div>
          <div className="surface grid gap-3 p-5 lg:col-[9/span_4] lg:row-[1/span_2] lg:self-start">
            <Bone className="h-3 w-20" />
            <Bone className="h-10 w-40" />
            {ROWS.slice(0, 3).map((row) => (
              <Bone key={row} className="h-5 w-full" />
            ))}
            <Bone className="mt-2 h-24 w-full" />
          </div>
          <div className="grid content-start gap-2.5 lg:col-[1/span_7] lg:row-start-2">
            <Bone className="h-4 w-full" />
            <Bone className="h-4 w-11/12" />
            <Bone className="h-4 w-2/3" />
            <div className="mt-6 flex gap-3">
              <Bone className="h-12 w-32 rounded-[999px]" />
              <Bone className="h-12 w-52 rounded-[999px]" />
            </div>
            <div className="mt-10 grid max-w-[26rem] gap-3 border-t border-line-2 pt-4">
              <Bone className="h-3 w-48" />
              <Bone className="h-10 w-24" />
              <Bone className="h-[3px] w-full" />
            </div>
          </div>
        </div>

        <div className="page-grid mt-[clamp(56px,7vw,96px)] gap-y-6">
          <div className="grid content-start gap-3 lg:col-[1/span_3]">
            <Bone className="h-3 w-28" />
            <Bone className="h-8 w-4/5" />
          </div>
          <div className="surface grid gap-5 p-5 lg:col-[4/span_9]">
            {ROWS.slice(0, 3).map((row) => (
              <div key={row} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4">
                <Bone className="h-3 w-6" />
                <div className="grid gap-2">
                  <Bone className="h-5 w-1/2" />
                  <Bone className="h-4 w-11/12" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-[clamp(56px,7vw,96px)] lg:grid lg:grid-cols-12 lg:gap-x-gutter">
          <div className="hidden gap-4 lg:col-span-3 lg:grid lg:content-start">
            {ROWS.map((row) => (
              <Bone key={row} className="h-6 w-4/5" />
            ))}
          </div>
          <div className="grid gap-16 lg:col-span-9">
            {SECTIONS.map((section) => (
              <div key={section} className="grid gap-4 border-t border-line-2 pt-8">
                <Bone className="h-3 w-12" />
                <Bone className="h-9 w-1/2" />
                <Bone className="mt-2 h-4 w-full max-w-[65ch]" />
                <Bone className="h-4 w-4/5 max-w-[60ch]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
