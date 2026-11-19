import type { TranslationState } from "@/lib/ai/contentTranslation";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { STATUS_LINE, StatusText } from "./TranslationStatus";

type TranslationNoticeProps = {
  state: TranslationState;
  className?: string;
};

/** Says when the content mixes languages: the translation failed, or some strings kept their original. */
export default async function TranslationNotice({ state, className }: TranslationNoticeProps) {
  if (state !== "unavailable" && state !== "partial") return null;
  const t = await getT("common");
  return (
    <p role="note" className={cn(STATUS_LINE, className)}>
      <StatusText>{t(state === "unavailable" ? "translation.unavailable" : "translation.partial")}</StatusText>
    </p>
  );
}
