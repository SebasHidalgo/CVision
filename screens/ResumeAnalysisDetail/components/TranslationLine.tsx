import TranslationNotice from "@/components/i18n/TranslationNotice";
import TranslationPending from "@/components/i18n/TranslationPending";
import type { TranslationState } from "@/lib/ai/contentTranslation";
import { translateAnalysisAction } from "../actions/translateAnalysisAction";

// The shared lines keep their behaviour; this restyles them for the dark page. Important flags: their own classes
// (the old mono eyebrow) are custom utilities whose order against ours is not guaranteed.
const LINE =
  "font-ed-text! text-ed-body! normal-case! tracking-normal! text-ed-ink-2! " +
  "[&>span:first-child]:bg-ed-ink-2 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:text-ed-ink [&_a]:decoration-ed-ink-3";

/** No translation yet: the prose shows skeletons and this line asks for it. A mixed page says so. */
export default function TranslationLine({ state, resumeId, className }: { state: TranslationState; resumeId: string; className?: string }) {
  if (state !== "pending" && state !== "unavailable" && state !== "partial") return null;
  return (
    <div className={className}>
      {state === "pending" ? (
        <TranslationPending translate={translateAnalysisAction} input={{ resumeId }} className={LINE} />
      ) : (
        <TranslationNotice state={state} className={LINE} />
      )}
    </div>
  );
}
