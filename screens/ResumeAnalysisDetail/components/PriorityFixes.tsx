import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import { ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ResumeAnalysisFeedback } from "@/types/resume";

type PriorityFixesProps = {
  fixes: ResumeAnalysisFeedback["overall"]["prioritizedFixes"];
};

// `impact` is an open string from the model; match by prefix, not equality.
function impactStyle(impact: string) {
  const value = impact.trim().toLowerCase();
  if (value.startsWith("high")) return "bg-signal text-paper";
  if (value.startsWith("med")) return "border border-ink text-ink";
  return "border border-line-strong text-ink-3";
}

export default function PriorityFixes({ fixes }: PriorityFixesProps) {
  if (fixes.length === 0) return null;

  return (
    <section aria-labelledby="fixes-title" className="py-10 lg:py-14">
      <Reveal>
        <Eyebrow tick>Fix these first</Eyebrow>
        <h2 id="fixes-title" className="display-md mt-4 text-ink">
          The changes that move the needle.
        </h2>
      </Reveal>

      <ol className="mt-8 divide-y divide-line border-y border-line">
        {fixes.map((fix, i) => (
          <Reveal key={`${fix.title}-${i}`} delay={i * 0.07}>
            <li className="grid gap-4 py-6 sm:grid-cols-[3rem_1fr_auto] sm:gap-6">
              <span className="eyebrow pt-1.5 text-ink">{ordinal(i)}</span>
              <div>
                <h3 className="display-sm text-ink">{fix.title}</h3>
                <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-2">
                  {fix.action}
                </p>
              </div>
              <span
                className={cn(
                  "h-fit w-fit px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] sm:justify-self-end",
                  impactStyle(fix.impact),
                )}
              >
                {fix.impact} impact
              </span>
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}
