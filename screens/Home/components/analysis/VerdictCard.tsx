"use client";

import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Surface } from "@/components/design-system/Surface";
import { toneKey, type ScoreTone } from "@/lib/score";
import { cn } from "@/lib/utils";
import type { CaseTally, KindCount } from "./tally";

const RULES: readonly ScoreTone[] = ["weak", "fair", "strong"];

/** The verdict word, its arithmetic, and the rule that turns one into the other. */
export function VerdictCard({ tone, tally, className }: { tone: ScoreTone; tally: CaseTally; className?: string }) {
  const { t } = useTranslation("landingAnalysis");
  const { t: common } = useTranslation("common");
  const count = (c: KindCount) =>
    c.partial
      ? t("verdict.countWithPartial", { met: c.met, total: c.total, partial: c.partial })
      : t("verdict.count", { met: c.met, total: c.total });
  const notShown = tally.required.notShown + tally.preferred.notShown;
  const rows = [
    { key: "required", label: common("verdict.required"), value: count(tally.required) },
    { key: "preferred", label: common("verdict.preferred"), value: count(tally.preferred) },
    ...(notShown ? [{ key: "notShown", label: common("verdict.notShown", { count: notShown }), value: String(notShown) }] : []),
  ];
  return (
    <Surface as="aside" aria-label={t("verdict.label")} className={cn("grid content-start gap-3.5 self-start px-5 pt-5 pb-[18px] max-sm:px-4", className)}>
      <p className="ed-cap">{common("verdict.cap")}</p>
      <p className="font-ed-display text-[34px] leading-[1.05] font-normal tracking-[-0.02em] [font-variation-settings:'opsz'_72,'SOFT'_0,'WONK'_0]">
        {common(toneKey("fit", tone))}
      </p>
      <dl className="grid border-t border-ed-line">
        {rows.map((row) => (
          <div key={row.key} className="flex justify-between gap-3 border-b border-ed-line py-2.5 text-[15px]">
            <dt className="text-ed-ink-2">{row.label}</dt>
            <dd className="ed-mono text-right text-[14px]">{row.value}</dd>
          </div>
        ))}
      </dl>
      {/* The app's rule, word for word: the analysis page prints the same sentences. */}
      <p className="text-[14px] text-ed-ink-3">
        {RULES.map((rule) => (
          <Fragment key={rule}>
            <strong className="font-semibold text-ed-ink-2">{common("verdictRule.term", { verdict: common(toneKey("fit", rule)) })}</strong>{" "}
            {common(`verdictRule.${rule}`)}{" "}
          </Fragment>
        ))}
        {common("verdictRule.notShown")}
      </p>
    </Surface>
  );
}
