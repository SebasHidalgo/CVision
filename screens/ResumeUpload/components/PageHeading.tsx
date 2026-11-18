/** A working page's head on the 12-column grid: the title over eight columns, the lede in the right rail. */
export default function PageHeading({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="ed-grid gap-y-4 pb-[clamp(28px,4vw,48px)] lg:items-end">
      <h1 className="ed-display text-ed-h2 text-balance lg:col-[1/span_8]">{title}</h1>
      {lede && <p className="max-w-[44ch] text-ed-lede text-ed-ink-2 lg:col-[9/span_4] lg:pb-1.5">{lede}</p>}
    </header>
  );
}
