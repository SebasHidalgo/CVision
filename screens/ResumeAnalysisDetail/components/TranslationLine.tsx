import TranslationNotice from "@/components/i18n/TranslationNotice";
import TranslationPending from "@/components/i18n/TranslationPending";
import type { TranslationState } from "@/lib/ai/contentTranslation";
import { translateAnalysisAction } from "../actions/translateAnalysisAction";

/** No translation yet: the prose shows skeletons and this line asks for it. A mixed page says so. */
export default function TranslationLine({ state, resumeId, className }: { state: TranslationState; resumeId: string; className?: string }) {
  if (state === "pending") return <TranslationPending translate={translateAnalysisAction} input={{ resumeId }} className={className} />;
  if (state === "unavailable" || state === "partial") return <TranslationNotice state={state} className={className} />;
  return null;
}
