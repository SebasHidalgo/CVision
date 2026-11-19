import Link from "next/link";
import type { GapOutcome } from "@/lib/ai/schemas";
import { cn } from "@/lib/utils";

// The report's small pieces. No hooks and no "use client": the page renders them on the server, the landing's
// replica on the client, from the same props.

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * How the model's prose renders: as it is, or (the page, while its translation is on its way) as a skeleton. A prop,
 * so the landing's replica doesn't carry the translation modules the page's renderer needs.
 */
export type ProseRenderer = (text: string, lines?: number) => React.ReactNode;
export const plainProse: ProseRenderer = (text) => text;

/** The level under this one. */
export const sub = (level: HeadingLevel): HeadingLevel => Math.min(level + 1, 6) as HeadingLevel;

/** A heading whose level the caller sets: the page starts at h1, the landing's replica (inside a section) at h3. */
export function Heading({ level, ...rest }: { level: HeadingLevel } & React.ComponentPropsWithoutRef<"h2">) {
  const Tag = `h${Math.min(level, 6)}` as "h1";
  return <Tag {...rest} />;
}

/**
 * The marks of an interview outcome. Shape carries it (filled, half, empty, dashed), the label is always written
 * beside it, and the colour is ink: an answer in the room is not a CV proof, and green is kept for what a CV proves.
 */
export type InkMarkShape = "full" | "half" | "empty" | "dashed";

const SHAPE: Record<InkMarkShape, string> = {
  full: "border-ink bg-ink",
  half: "border-ink bg-[linear-gradient(to_top,var(--color-ink)_50%,transparent_50%)]",
  empty: "border-ink-2",
  dashed: "border-dashed border-ink-2",
};

export const OUTCOME_SHAPE: Record<GapOutcome, InkMarkShape> = {
  addressed: "full",
  partially: "half",
  dodged: "empty",
  not_raised: "dashed",
};

export function InkMark({ shape, className }: { shape: InkMarkShape; className?: string }) {
  return <span aria-hidden data-mark={shape} className={cn("inline-block size-[11px] flex-none border-[1.5px]", SHAPE[shape], className)} />;
}

/** The candidate's own words, set apart from the report around them. Verbatim, so never translated. */
export function SpokenQuote({ text, size = "body", className }: { text: string; size?: "body" | "small"; className?: string }) {
  return (
    <blockquote
      translate="no"
      className={cn(
        "rounded-r-[4px] bg-raise py-2.5 pr-4 pl-4 break-words text-ink shadow-[inset_2px_0_0_var(--color-line-2)] [overflow-wrap:anywhere]",
        size === "body" ? "text-body leading-[1.6]" : "text-small leading-[1.55]",
        className,
      )}
    >
      “{text}”
    </blockquote>
  );
}

/** The section's eyebrow: a short rule, then the label. */
export const EYEBROW = "cap inline-flex items-center gap-2 before:h-px before:w-3.5 before:bg-current before:content-['']";

/**
 * One section of the report on the 12-column grid: its eyebrow and title in the left rail, the content beside it
 * from 1024 px, stacked below. `part` names it for the structure checks (the e2e compares the landing's and the app's).
 */
export function ReportSection({
  part,
  id,
  eyebrow,
  title,
  level,
  embedded,
  children,
}: {
  part: string;
  id: string;
  eyebrow: string;
  /** Without one, the eyebrow is the section's heading. */
  title?: string;
  level: HeadingLevel;
  embedded: boolean;
  children?: React.ReactNode;
}) {
  return (
    // The region is named by its eyebrow and its title together: the eyebrow says which section it is.
    <section
      aria-labelledby={title === undefined ? id : `${id}-eyebrow ${id}`}
      data-feedback-part={part}
      className={cn("page-grid gap-y-7 border-b border-line", embedded ? "py-7" : "py-[clamp(40px,5.5vw,72px)]")}
    >
      <div className="lg:col-[1/span_4]">
        {title === undefined ? (
          <Heading level={level} id={id} className={EYEBROW}>
            {eyebrow}
          </Heading>
        ) : (
          <>
            <p id={`${id}-eyebrow`} className={EYEBROW}>
              {eyebrow}
            </p>
            <Heading
              level={level}
              id={id}
              className="mt-3 max-w-[24ch] font-display text-[clamp(24px,2.3vw,32px)] leading-[1.12] font-normal tracking-[-0.02em] text-balance text-ink"
            >
              {title}
            </Heading>
          </>
        )}
      </div>
      {children !== undefined && <div className="min-w-0 lg:col-[5/span_8]">{children}</div>}
    </section>
  );
}

/**
 * A link, or (in the landing's replica, where nothing navigates) the same words without one: a picture of the
 * control, never a button that does nothing.
 */
export function MaybeLink({ href, className, children }: { href: string | null; className?: string; children: React.ReactNode }) {
  if (href === null) return <span className={className}>{children}</span>;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
