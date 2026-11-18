import Prose from "@/components/i18n/Prose";
import { cn } from "@/lib/utils";

/** The shared Prose (model prose, or its skeleton while the translation is on its way) with dark skeleton bars. */
export default function ProseText({ text, lines, className }: { text: string; lines?: number; className?: string }) {
  return <Prose text={text} lines={lines} className={cn("[&>span]:bg-ed-line-2", className)} />;
}
