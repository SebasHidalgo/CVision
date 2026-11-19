import { cn } from "@/lib/utils";

/** The translation status line: body text in ink-2 that wraps on a narrow column. */
export const STATUS_LINE = "flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-ink-2";

/** Its link: page ink with a quiet underline, 44 px tall. */
export const STATUS_LINK =
  "inline-flex min-h-11 items-center text-ink underline decoration-ink-3 underline-offset-4 " +
  "transition-[text-decoration-color] duration-200 hover:decoration-ink motion-reduce:transition-none";

/**
 * The line's sentence behind a small ink square, centred on its first line. The square pulses while the work runs
 * and holds still under reduced motion. Never the signal green: that marks only what a CV proves.
 */
export function StatusText({ pulse = false, children }: { pulse?: boolean; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-start gap-3">
      <span aria-hidden className="flex h-lh shrink-0 items-center">
        <span data-status-mark className={cn("size-1.5 bg-ink-2", pulse && "motion-safe:animate-pulse")} />
      </span>
      <span>{children}</span>
    </span>
  );
}
