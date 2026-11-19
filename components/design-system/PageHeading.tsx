import { cn } from "@/lib/utils";

type PageHeadingProps = {
  title: string;
  /** With an id the title can take focus programmatically, so a control that removes itself can hand focus back. */
  id?: string;
  /** One line beside the title, in the right rail. */
  lede?: string;
  /** A figure block in the right rail instead of a lede. */
  aside?: React.ReactNode;
  /** A rule under the heading, for a page whose content starts without one. */
  ruled?: boolean;
};

/** A working page's head on the 12-column grid: the title over eight columns, a lede or a block in the right rail. */
export function PageHeading({ title, id, lede, aside, ruled = false }: PageHeadingProps) {
  return (
    <header className={cn("page-grid gap-y-5 lg:items-end", ruled ? "border-b border-line-2 pb-8 lg:pb-10" : "pb-[clamp(28px,4vw,48px)]")}>
      <h1 id={id} tabIndex={id ? -1 : undefined} className="display text-h2 text-balance text-ink lg:col-[1/span_8]">
        {title}
      </h1>
      {lede && <p className="max-w-[44ch] text-lede text-ink-2 lg:col-[9/span_4] lg:pb-1.5">{lede}</p>}
      {aside && <div className="lg:col-[9/span_4] lg:justify-self-end lg:pb-2">{aside}</div>}
    </header>
  );
}
