import { Surface } from "@/components/design-system/Surface";
import Prose from "@/components/i18n/Prose";
import { ordinal } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import type { ResumeAnalysisFeedback } from "@/types/resume";

type PriorityFixesProps = {
  fixes: ResumeAnalysisFeedback["overall"]["prioritizedFixes"];
  className?: string;
};

// `impact` is an open string from the model; match by prefix, not equality. Weight, not colour, ranks it.
function impactStyle(impact: string) {
  const value = impact.trim().toLowerCase();
  if (value.startsWith("high")) return "border-ink bg-ink text-bg";
  if (value.startsWith("med")) return "border-ink text-ink";
  return "border-line-2 text-ink-2";
}

/** The three levels the prompt asks for get the interface's words; anything else is shown as the model wrote it. */
function impactKey(impact: string) {
  const value = impact.trim().toLowerCase();
  if (value === "high") return "fixes.impact.high" as const;
  if (value === "medium") return "fixes.impact.medium" as const;
  if (value === "low") return "fixes.impact.low" as const;
  return "fixes.impact.other" as const;
}

/** What to change first, in the model's order, beside the report's index column. */
export default async function PriorityFixes({ fixes, className }: PriorityFixesProps) {
  if (fixes.length === 0) return null;
  const t = await getT("analysis");

  return (
    <section aria-labelledby="fixes-title" className={cn("page-grid gap-y-6", className)}>
      <div className="lg:col-[1/span_3]">
        <p className="cap">{t("fixes.eyebrow")}</p>
        <h2 id="fixes-title" className="display mt-3 text-[clamp(28px,2.6vw,38px)] leading-[1.08] tracking-[-0.025em] text-balance">
          {t("fixes.title")}
        </h2>
      </div>

      <Surface as="ol" className="px-5 max-sm:px-4 lg:col-[4/span_9]">
        {fixes.map((fix, i) => (
          <li
            key={`${fix.title}-${i}`}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-b border-line py-5 last:border-b-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]"
          >
            <span aria-hidden className="mono pt-1 text-[13px] text-ink-3">
              {ordinal(i)}
            </span>
            <div className="min-w-0 max-w-[65ch]">
              <h3 className="text-[17px] leading-[1.4] font-semibold text-ink">
                <Prose text={fix.title} lines={1} className="w-2/3" />
              </h3>
              <p className="mt-2 text-body text-ink-2">
                <Prose text={fix.action} />
              </p>
            </div>
            <span
              className={cn(
                "col-start-2 h-fit w-fit rounded-full border px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap sm:col-start-3 sm:row-start-1",
                impactStyle(fix.impact),
              )}
            >
              {t(impactKey(fix.impact), { impact: fix.impact })}
            </span>
          </li>
        ))}
      </Surface>
    </section>
  );
}
