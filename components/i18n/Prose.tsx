import { PENDING_PROSE } from "@/lib/i18n/analysisView";
import { cn } from "@/lib/utils";

type ProseProps = {
  text: string;
  /** Skeleton lines while the translation is on its way. */
  lines?: number;
  className?: string;
};

export const isPendingProse = (text: string | undefined) => text === PENDING_PROSE;

/**
 * Model-written prose, or its skeleton while the translation is on its way. Only prose waits:
 * scores, statuses, quotes and row titles render around it. The page's status line announces it.
 */
export default function Prose({ text, lines = 2, className }: ProseProps) {
  if (!isPendingProse(text)) return <>{text}</>;
  return (
    <span data-prose-pending aria-hidden className={cn("block space-y-2 py-1", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={cn("block h-[0.8em] animate-pulse rounded-sm bg-paper-3", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full")} />
      ))}
    </span>
  );
}
