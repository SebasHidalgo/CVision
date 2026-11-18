/**
 * A working page's head on the grid: the title, and an optional figure block on the right from 1024 px. The title
 * takes focus programmatically (tabIndex -1) so a control that removes itself can hand focus back here.
 */
export function PageHeading({ title, id, aside }: { title: string; id: string; aside?: React.ReactNode }) {
  return (
    <header className="ed-grid gap-y-6 border-b border-ed-line-2 pb-8 lg:items-end lg:pb-10">
      <h1 id={id} tabIndex={-1} className="ed-display text-ed-h2 text-balance text-ed-ink lg:col-span-8">
        {title}
      </h1>
      {aside && <div className="lg:col-span-4 lg:justify-self-end lg:pb-2">{aside}</div>}
    </header>
  );
}
