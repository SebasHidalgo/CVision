import { cn } from "@/lib/utils";
import { displayQuote } from "../utils/displayQuote";

type CvQuoteProps = {
  text: string;
  /** The CV proves what the row claims: the signal bar. Otherwise a quiet bar. */
  proof?: boolean;
  /** A small caption above the line ("From your CV"). */
  caption?: string;
  className?: string;
};

/**
 * A line quoted from the CV, set apart from the analysis around it. Verbatim, so it is never translated
 * (`translate="no"` keeps a browser's page translation off it too).
 */
export function CvQuote({ text, proof = false, caption, className }: CvQuoteProps) {
  return (
    <figure className={cn("grid gap-1.5", className)}>
      {caption && <figcaption className="ed-cap">{caption}</figcaption>}
      <blockquote
        translate="no"
        className={cn(
          "rounded-r-[4px] py-2.5 pr-4 pl-4 text-ed-body break-words text-ed-ink",
          proof ? "bg-ed-signal-wash shadow-ed-proof" : "bg-ed-raise shadow-[inset_2px_0_0_var(--color-ed-line-2)]",
        )}
      >
        {displayQuote(text)}
      </blockquote>
    </figure>
  );
}
