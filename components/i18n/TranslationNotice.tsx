import type { TranslationState } from "@/lib/ai/contentTranslation";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

type TranslationNoticeProps = {
  state: TranslationState;
  className?: string;
};

/** Says when the content mixes languages: the translation failed, or some strings kept their original. */
export default async function TranslationNotice({ state, className }: TranslationNoticeProps) {
  if (state !== "unavailable" && state !== "partial") return null;
  const t = await getT("common");
  return (
    <p role="note" className={cn("eyebrow flex items-center gap-3 text-ink-2", className)}>
      <span aria-hidden className="size-1.5 shrink-0 bg-fair" />
      {t(state === "unavailable" ? "translation.unavailable" : "translation.partial")}
    </p>
  );
}
