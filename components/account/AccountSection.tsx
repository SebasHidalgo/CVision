import { cn } from "@/lib/utils";

type AccountSectionProps = {
  /** "01": the section's place on the page. */
  n: string;
  id: string;
  title: string;
  /** A line under the title, in the left rail (the period's reset, a warning). */
  note?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

/**
 * One entry of an account page's ledger on the 12-column grid: number and title in the left rail, the content over
 * the right eight columns; a rule above every entry but the first.
 */
export function AccountSection({ n, id, title, note, className, children }: AccountSectionProps) {
  return (
    <section
      aria-labelledby={id}
      className={cn("ed-grid gap-y-5 border-t border-ed-line py-[clamp(28px,4vw,48px)] first:border-t-0 lg:gap-y-0", className)}
    >
      <header className="lg:col-[1/span_4] lg:pr-6">
        <p aria-hidden className="ed-mono text-[13px] text-ed-ink-3">
          {n}
        </p>
        <h2 id={id} className="mt-2 text-ed-h3 font-semibold text-balance text-ed-ink">
          {title}
        </h2>
        {note && <div className="mt-2 max-w-[36ch] text-ed-body text-ed-ink-2">{note}</div>}
      </header>
      <div className="min-w-0 lg:col-[5/span_8]">{children}</div>
    </section>
  );
}

type UsageRowProps = {
  label: string;
  /** The figure, or the state in words, on its own line. */
  figure: React.ReactNode;
  children?: React.ReactNode;
};

/** A labelled figure of a ledger (`<dl>` child): the label in the left column from sm up, the figure and its notes beside it. */
export function UsageRow({ label, figure, children }: UsageRowProps) {
  return (
    <div className="grid gap-x-8 gap-y-2 border-t border-ed-line py-5 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)]">
      <dt className="text-ed-small text-ed-ink-2 sm:pt-1">{label}</dt>
      <dd className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">{figure}</div>
        {children}
      </dd>
    </div>
  );
}

/** A count as a figure: the number in mono, what it counts against beside it. */
export function Figure({ value, of }: { value: number; of?: string }) {
  return (
    <>
      <span className="ed-mono text-[24px] leading-none text-ed-ink">{value}</span>
      {of && <span className="text-ed-body text-ed-ink-2">{of}</span>}
    </>
  );
}

/** A small allowance drawn as cells, filled for what is left. Decorative: the figure beside it says the same. */
export function Cells({ total, left }: { total: number; left: number }) {
  return (
    <span aria-hidden data-cells={`${left}/${total}`} className="inline-flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn("size-[11px] border-[1.5px]", i < left ? "border-ed-ink bg-ed-ink" : "border-ed-ink-3")} />
      ))}
    </span>
  );
}

/** A note under a figure: body-size text kept to a reading measure. */
export function RowNote({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[62ch] text-ed-body text-ed-ink-2">{children}</p>;
}
