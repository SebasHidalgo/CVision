import { Bone } from "@/components/design-system/Bone";
import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { Surface } from "@/components/design-system/Surface";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { ROW_GRID } from "./components/InterviewRow";

const ROWS = [0, 1, 2];

/** Mirrors the list (the heading with its counts, the plan line, the rows) so nothing jumps when the data lands. */
export default async function InterviewsLoading() {
  const t = await getT("interview");
  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div aria-busy="true" className="wrap pt-[clamp(40px,6vw,88px)] pb-section">
        <PageHeading ruled title={t("list.title")} aside={<CountsBone />} />
        <p role="status" className="sr-only">
          {t("list.loading")}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Bone className="h-3 w-24" />
          <Bone className="h-4 w-72 max-w-full" />
        </div>
        <Surface as="ol" aria-hidden className="mt-10 divide-y divide-line overflow-hidden">
          {ROWS.map((row) => (
            <li key={row} className={ROW_GRID}>
              <Bone className="mt-1 h-3 w-5 [grid-area:n]" />
              <div className="grid gap-2.5 [grid-area:title]">
                <Bone className="h-3 w-36" />
                <Bone className="h-5 w-3/5" />
                <Bone className="h-4 w-2/5" />
              </div>
              <div className="grid gap-3 [grid-area:state]">
                <Bone className="h-4 w-40" />
                <Bone className="h-3 w-24" />
              </div>
            </li>
          ))}
        </Surface>
      </div>
    </div>
  );
}

/** The heading's two counts. */
function CountsBone() {
  return (
    <div className="flex gap-8">
      <Bone className="h-5 w-24" />
      <Bone className="h-5 w-28" />
    </div>
  );
}
