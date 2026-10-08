import { describeTally, type FitVerdict } from "@/lib/schemas/resumeSchema";
import { FIT_LABEL, TONE_CLASS } from "@/lib/score";
import { cn } from "@/lib/utils";

type VerdictReadoutProps = {
  verdict: FitVerdict;
  className?: string;
};

/**
 * The headline fit answer. A word rather than a number, because it is derived
 * from the requirements breakdown and that only supports three outcomes; the
 * counts underneath are the arithmetic, so the reader can check the verdict
 * instead of taking it on trust. A wrong verdict is then visibly wrong in the
 * breakdown above it rather than wrong for invisible reasons.
 */
export default function VerdictReadout({
  verdict,
  className,
}: VerdictReadoutProps) {
  return (
    <div className={cn("lg:text-right", className)}>
      <p
        className={cn(
          "display-lg text-[clamp(2.5rem,2rem+3vw,4.5rem)] leading-none",
          TONE_CLASS[verdict.tone].text,
        )}
      >
        {FIT_LABEL[verdict.tone]}
      </p>
      <p className="mt-3 font-mono text-[12px] leading-relaxed text-ink-2">
        {describeTally(verdict.tally)}
      </p>
    </div>
  );
}
