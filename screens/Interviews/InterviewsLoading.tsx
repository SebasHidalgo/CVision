import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { Surface } from "@/components/design-system/Surface";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { ROW_GRID } from "./components/InterviewRow";

const ROWS = [0, 1, 2];
const BLOCK = "rounded-[3px] bg-ed-raise motion-safe:animate-pulse";

/** Mirrors the list's rows so nothing jumps when the data lands. Decorative: the status line announces loading. */
export default async function InterviewsLoading() {
  const t = await getT("interview");
  return (
    <div className={cn("ed-root flex-1", fontText.variable)}>
      <div className="ed-wrap pt-[clamp(40px,6vw,88px)] pb-ed-section">
        <PageHeading id="interviews-title" ruled title={t("list.title")} />
        <p role="status" className="sr-only">
          {t("list.loading")}
        </p>
        <div aria-hidden className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={cn(BLOCK, "h-3 w-24")} />
          <span className={cn(BLOCK, "h-4 w-72 max-w-full")} />
        </div>
        <Surface as="ol" aria-hidden className="mt-10 divide-y divide-ed-line overflow-hidden">
          {ROWS.map((row) => (
            <li key={row} className={ROW_GRID}>
              <span className={cn(BLOCK, "mt-1 h-3 w-5 [grid-area:n]")} />
              <div className="grid gap-2.5 [grid-area:title]">
                <span className={cn(BLOCK, "h-3 w-36")} />
                <span className={cn(BLOCK, "h-5 w-3/5")} />
                <span className={cn(BLOCK, "h-4 w-2/5")} />
              </div>
              <div className="grid gap-3 [grid-area:state]">
                <span className={cn(BLOCK, "h-4 w-40")} />
                <span className={cn(BLOCK, "h-3 w-24")} />
              </div>
            </li>
          ))}
        </Surface>
      </div>
    </div>
  );
}
