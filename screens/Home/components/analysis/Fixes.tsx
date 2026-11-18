"use client";

import { useTranslation } from "react-i18next";
import { Surface } from "@/components/design-system/Surface";
import { ordinal } from "@/lib/format";
import { FIXES } from "./exampleReport";

/** The prioritized fixes, in the order the analysis page lists them. */
export function Fixes() {
  const { t } = useTranslation("landingAnalysis");
  return (
    <div className="ed-grid mt-[clamp(56px,7vw,96px)] gap-y-4">
      <h3 className="text-ed-h3 font-semibold lg:col-[1/span_3]">{t("fixes.title")}</h3>
      <Surface as="ol" className="px-5 max-sm:px-4 lg:col-[4/span_9]">
        {FIXES.map((fix, i) => (
          <li
            key={fix.id}
            className="grid grid-cols-[40px_120px_minmax(0,1fr)] items-baseline gap-4 border-b border-ed-line py-3.5 last:border-b-0 max-sm:grid-cols-[30px_minmax(0,1fr)] max-sm:gap-y-1"
          >
            <span className="ed-mono text-[13px] text-ed-ink-3">{ordinal(i)}</span>
            <span className="text-[13.5px] text-ed-ink-2">{t(`fixes.impact.${fix.impact}`)}</span>
            <span className="max-sm:col-start-2">{t(`fixes.items.${fix.id}`)}</span>
          </li>
        ))}
      </Surface>
    </div>
  );
}
