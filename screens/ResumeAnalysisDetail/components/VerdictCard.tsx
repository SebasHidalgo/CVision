import type { TFunction } from "i18next";
import { Surface } from "@/components/design-system/Surface";
import type { FitVerdict, RequirementTally } from "@/lib/schemas/resumeSchema";
import { toneKey, type ScoreTone } from "@/lib/score";
import { cn } from "@/lib/utils";

const TONES: readonly ScoreTone[] = ["weak", "fair", "strong"];

type VerdictCardProps = {
  verdict: FitVerdict;
  t: TFunction<"analysis">;
  common: TFunction<"common">;
  className?: string;
};

/**
 * The fit answer, its arithmetic and the rule between them. A word, not a number: it is derived from the
 * requirements breakdown, which supports three outcomes. The counts and the rule are printed so a reader can check
 * the verdict against the rows below instead of taking it on trust.
 */
export function VerdictCard({ verdict, t, common, className }: VerdictCardProps) {
  const { tone, tally } = verdict;
  const count = (c: RequirementTally["required"]) =>
    c.partial
      ? t("requirements.countWithPartial", { met: c.met, total: c.total, partial: c.partial })
      : t("requirements.count", { met: c.met, total: c.total });
  const notShown = tally.required.notShown + tally.preferred.notShown;
  // deriveFitVerdict reads a breakdown with no required item as weak: that is an extraction gap, not the weak rule.
  const empty = tally.required.total + tally.required.notShown === 0;
  const rows = [
    { key: "required", label: t("verdict.required"), value: count(tally.required) },
    { key: "preferred", label: t("verdict.preferred"), value: count(tally.preferred) },
    ...(notShown ? [{ key: "notShown", label: t("verdict.notShown", { count: notShown }), value: String(notShown) }] : []),
  ];

  return (
    <Surface as="aside" aria-labelledby="verdict-cap verdict-title" className={cn("grid content-start gap-4 px-5 pt-5 pb-5 max-sm:px-4", className)}>
      <div>
        <p id="verdict-cap" className="ed-cap">
          {t("verdict.cap")}
        </p>
        <p
          id="verdict-title"
          className="mt-2 font-ed-display text-[clamp(34px,3vw,42px)] leading-[1.04] font-normal tracking-[-0.02em] [font-variation-settings:'opsz'_72,'SOFT'_0,'WONK'_0]"
        >
          {common(toneKey("fit", tone))}
        </p>
      </div>

      <dl className="border-t border-ed-line">
        {rows.map((row) => (
          // A value that does not fit beside its label drops below it whole, still flush right.
          <div key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-ed-line py-2.5 text-[15px]">
            <dt className="text-ed-ink-2">{row.label}</dt>
            <dd className="ml-auto text-right text-ed-ink tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="ed-cap">{t("verdict.ruleTitle")}</p>
        {empty ? (
          <p className="mt-2.5 text-[15px] text-ed-ink-2">{t("verdict.rule.empty")}</p>
        ) : (
          <dl className="mt-2.5 grid gap-2.5 text-[15px] leading-[1.5]">
            {TONES.map((rule) => {
              const applies = rule === tone;
              return (
                <div
                  key={rule}
                  className={cn("grid gap-0.5 pl-3", applies ? "text-ed-ink shadow-[inset_2px_0_0_var(--color-ed-ink)]" : "text-ed-ink-2")}
                >
                  <dt className="font-semibold">
                    {common(toneKey("fit", rule))}
                    {applies && <span className="sr-only"> ({t("verdict.rule.applies")})</span>}
                  </dt>
                  <dd>{common(`verdictRule.${rule}`)}</dd>
                </div>
              );
            })}
          </dl>
        )}
        <p className="mt-3 text-[15px] text-ed-ink-2">{common("verdictRule.notShown")}</p>
      </div>
    </Surface>
  );
}
