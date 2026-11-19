import { cn } from "@/lib/utils";

/** A section's head on the 12-column grid: number, title, and an optional lede in the right rail. */
export function SectionHeading({
  n,
  id,
  title,
  lede,
  className,
}: {
  n: string;
  id: string;
  title: string;
  lede?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("page-grid mb-[clamp(36px,5vw,64px)] gap-y-3.5 border-t border-line-2 pt-[18px]", className)}>
      <p aria-hidden className="mono text-[13px] text-ink-3 lg:col-span-1 lg:pt-2.5">
        {n}
      </p>
      <h2 id={id} className="display text-h2 text-balance lg:col-start-2 lg:col-end-8">
        {title}
      </h2>
      {lede && <div className="max-w-[44ch] text-[17px] text-ink-2 lg:col-start-9 lg:col-end-13 lg:pt-2.5">{lede}</div>}
    </div>
  );
}
