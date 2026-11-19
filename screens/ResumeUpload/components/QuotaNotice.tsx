"use client";

import { useTranslation } from "react-i18next";
import { ButtonLink } from "@/components/design-system/Button";
import { Surface } from "@/components/design-system/Surface";
import { PLANS, type AnalysisQuotaView } from "@/lib/plans";
import { cn } from "@/lib/utils";

/** The status line's id: the disabled submit points at it. */
export const QUOTA_STATUS_ID = "upload-quota-status";

/** Nothing left this period: why, when it resets and, for Free, what Pro gives. Above the form, before any typing. */
export function QuotaExhausted({ quota, line }: { quota: AnalysisQuotaView; line: string }) {
  const { t } = useTranslation("upload");
  return (
    <Surface className="mb-[clamp(24px,3.5vw,40px)] grid gap-4 px-5 py-5 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:px-6">
      <div className="grid gap-1.5">
        <p id={QUOTA_STATUS_ID} role="status" className="text-h3 font-semibold text-ink">
          {line}
        </p>
        {quota.plan === "FREE" && <p className="text-ink-2">{t("form.proOffer", { limit: PLANS.PRO.analysesPerMonth })}</p>}
      </div>
      {quota.plan === "FREE" && (
        <ButtonLink href="/pricing" variant="ghost" size="sm" className="justify-self-start">
          {t("form.seePro")}
        </ButtonLink>
      )}
    </Surface>
  );
}

/** One mark per analysis in the allowance: filled for the ones left. Drawn only for a small, announced allowance. */
function Allowance({ left, limit }: { left: number; limit: number }) {
  if (limit > 10) return null;
  return (
    <span aria-hidden className="flex flex-none gap-1">
      {Array.from({ length: limit }, (_, i) => (
        <span key={i} className={cn("size-[9px] border-[1.5px] border-ink-2", i < left && "border-ink bg-ink")} />
      ))}
    </span>
  );
}

/** The line beside the submit: the Free allowance, or how the run works. */
export function QuotaCount({ quota, line, idle }: { quota: AnalysisQuotaView; line: string | null; idle: string }) {
  return (
    <p className="flex items-center gap-3 text-small text-ink-2">
      {line && <Allowance left={quota.left} limit={quota.limit} />}
      <span>{line ?? idle}</span>
    </p>
  );
}
