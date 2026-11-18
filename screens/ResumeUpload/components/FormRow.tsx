type FormRowProps = {
  /** "01", "02": the row's place in the form. */
  n: string;
  /** The heading's content: plain text, or the control's <label> when the heading is what names it. */
  title: React.ReactNode;
  note: string;
  /** For the controls' `aria-describedby`. */
  noteId: string;
  children: React.ReactNode;
};

/** One numbered row of the form on the 12-column grid: number, heading and note in the left rail, controls beside. */
export default function FormRow({ n, title, note, noteId, children }: FormRowProps) {
  return (
    <div className="ed-grid gap-y-5 border-t border-ed-line-2 py-[clamp(24px,3.5vw,40px)]">
      <div className="grid content-start gap-2 lg:col-[1/span_4] lg:pr-ed-gutter">
        <p aria-hidden className="ed-mono text-[13px] text-ed-ink-3">
          {n}
        </p>
        <h2 className="text-ed-h3 font-semibold text-ed-ink">{title}</h2>
        <p id={noteId} className="max-w-[44ch] text-ed-ink-2">
          {note}
        </p>
      </div>
      <div className="lg:col-[5/span_8] lg:max-w-[75ch]">{children}</div>
    </div>
  );
}
