import { Bone } from "@/components/design-system/Bone";
import { fontText } from "@/components/design-system/fonts";
import { getT } from "@/lib/i18n/server";
import type { LegalPage } from "@/lib/legal";
import { cn } from "@/lib/utils";

const ENTRIES = [0, 1, 2, 3, 4, 5];
const SECTIONS = [0, 1, 2];

/** The legal page's frame while it loads: its title at once (it never changes), then bones where the text will be. */
export default async function LegalLoading({ page }: { page: LegalPage }) {
  const t = await getT("legal");
  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div aria-busy="true" className="wrap pt-[clamp(24px,4vw,48px)] pb-section">
        <p role="status" className="sr-only">
          {t("loading")}
        </p>
        <Bone className="h-[74px] w-full max-w-[92ch] rounded-surface sm:h-14" />

        <div className="page-grid gap-y-5 border-b border-line-2 pt-[clamp(32px,5vw,64px)] pb-8 lg:items-end lg:pb-10">
          <Bone className="h-3 w-44 lg:col-span-12" />
          <p className="display text-h2 text-balance text-ink lg:col-[1/span_8]">{t(`${page}.title`)}</p>
          <div className="grid gap-2.5 lg:col-[9/span_4] lg:pb-1.5">
            <Bone className="h-4 w-full" />
            <Bone className="h-4 w-4/5" />
          </div>
        </div>

        <div className="page-grid gap-y-10 pt-[clamp(32px,4.5vw,56px)]">
          <div className="lg:col-[1/span_3]">
            <Bone className="h-3 w-28" />
            <div className="mt-3 border-t border-line">
              {ENTRIES.map((entry) => (
                <div key={entry} className="flex min-h-11 items-center gap-3 border-b border-line py-2.5">
                  <Bone className="h-3 w-5" />
                  <Bone className="h-3.5 w-3/5" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-[clamp(56px,7vw,80px)] lg:col-[5/span_8]">
            {SECTIONS.map((section) => (
              <div key={section} className="grid max-w-[68ch] gap-3">
                <Bone className="h-6 w-2/5" />
                <Bone className="mt-2 h-4 w-full" />
                <Bone className="h-4 w-full" />
                <Bone className="h-4 w-11/12" />
                <Bone className="h-4 w-3/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
