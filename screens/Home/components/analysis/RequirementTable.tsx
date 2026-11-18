"use client";

import { useTranslation } from "react-i18next";
import { Surface } from "@/components/design-system/Surface";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { cn } from "@/lib/utils";
import { RequirementRow, ROW_GRID } from "./RequirementRow";

/** The example's requirements as rows; the column header is visual only (each row's cells say what they are). */
export function RequirementTable({ requirements, className }: { requirements: LocalizedRequirement[]; className?: string }) {
  const { t } = useTranslation("landingAnalysis");
  return (
    <Surface className={cn("px-5 pt-3.5 pb-2 max-sm:px-4", className)}>
      <div
        aria-hidden
        className={cn(ROW_GRID, "ed-cap hidden border-b border-ed-line-2 pb-2.5 min-[1100px]:grid")}
      >
        <span className="[grid-area:n]">{t("requirements.columns.n")}</span>
        <span className="[grid-area:text]">{t("requirements.columns.requirement")}</span>
        <span className="[grid-area:kind]">{t("requirements.columns.kind")}</span>
        <span className="[grid-area:status]">{t("requirements.columns.status")}</span>
        <span className="[grid-column:5/-1]">{t("requirements.columns.evidence")}</span>
      </div>
      <ol aria-label={t("requirements.listLabel")}>
        {requirements.map((r) => (
          <RequirementRow key={r.id} requirement={r} />
        ))}
      </ol>
      <p className="border-t border-ed-line pt-2.5 pb-2 text-[14px] text-ed-ink-3">{t("requirements.hint")}</p>
    </Surface>
  );
}
