"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { buttonClass, textLinkClass } from "@/components/design-system/Button";
import { ConfirmDialog } from "@/components/design-system/ConfirmDialog";

/** A confirmation's words. */
export type ConfirmCopy = { title: string; body: string; confirmLabel: string; cancelLabel: string };

/** One hidden item as a list shows it: told apart, never opened. Every string arrives in the page's language. */
export type HiddenRow = {
  id: string;
  /** Its place in the whole list ("04"), continuing the visible rows' numbering. */
  n: string;
  company: string;
  /** The role: the analysis's job title, or the interview's. */
  title: string;
  date: string;
  dateTime: string;
  /** The delete button's accessible name: which item it deletes. */
  deleteLabel: string;
  confirm: ConfirmCopy;
};

type HiddenBlockProps = {
  /** Which list: names the data attributes (`data-hidden-analyses` and `data-hidden-analysis`, or the interviews'). */
  kind: "analyses" | "interviews";
  /** How many are hidden. */
  title: string;
  /** Why: the plan shows the last few, Pro shows everything, nothing was deleted. */
  why: string;
  seePro: string;
  listLabel: string;
  /** The visible text of each row's delete button. */
  deleteRow: string;
  deleteAll: { label: string; confirm: ConfirmCopy };
  pendingLabel: string;
  rows: HiddenRow[];
  /** Run once confirmed; each resolves to the line said afterwards, failures included (never rejects). */
  onDeleteOne: (row: HiddenRow) => Promise<string>;
  onDeleteAll: () => Promise<string>;
};

type Target = { kind: "all" } | { kind: "one"; row: HiddenRow };

/**
 * What a plan's history hides from a list (analyses, or their interviews): how many, why, and the only way to delete
 * them, since their pages don't open. Presentational: the words, the rows and the deletions come from the list; this
 * holds the confirmation and its pending state. Always mounted, even with nothing hidden, so the outcome line survives
 * deleting the last one; after an outcome focus moves to that line (the button that opened the dialog may be gone),
 * after a cancel back to that button.
 */
export function HiddenBlock({ kind, title, why, seePro, listLabel, deleteRow, deleteAll, pendingLabel, rows, onDeleteOne, onDeleteAll }: HiddenBlockProps) {
  const [target, setTarget] = useState<Target | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const focusOutcome = useRef(false);
  const analyses = kind === "analyses";
  const headingId = `hidden-${kind}-title`;

  const open = (next: Target, opener: HTMLElement) => {
    openerRef.current = opener;
    setTarget(next);
  };

  const confirm = async () => {
    if (!target || pending) return;
    setPending(true);
    try {
      const text = await (target.kind === "one" ? onDeleteOne(target.row) : onDeleteAll());
      focusOutcome.current = true;
      setOutcome(text);
    } finally {
      setPending(false);
      setTarget(null);
    }
  };

  const dialog = target?.kind === "one" ? target.row.confirm : deleteAll.confirm;

  return (
    <div>
      <p ref={outcomeRef} tabIndex={-1} data-deletion-outcome className="mt-8 w-fit max-w-[75ch] rounded-ed-field border border-ed-line-2 bg-ed-panel px-4 py-3 text-ed-body text-ed-ink empty:hidden">
        {outcome}
      </p>

      {rows.length > 0 && (
        <section
          data-hidden-analyses={analyses ? "" : undefined}
          data-hidden-interviews={analyses ? undefined : ""}
          aria-labelledby={headingId}
          className="ed-surface mt-8 border-dashed px-6 pt-6 pb-2 max-sm:px-4"
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <h2 id={headingId} className="text-ed-h3 font-semibold text-balance text-ed-ink">
                {title}
              </h2>
              <p className="mt-2 max-w-[68ch] text-ed-body text-ed-ink-2">{why}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <button type="button" onClick={(event) => open({ kind: "all" }, event.currentTarget)} className={buttonClass({ variant: "ghost", size: "sm" })}>
                {deleteAll.label}
              </button>
              <Link href="/pricing" className={textLinkClass}>
                {seePro}
              </Link>
            </div>
          </div>

          <ol aria-label={listLabel} className="mt-6">
            {rows.map((row) => (
              <li
                key={row.id}
                data-hidden-analysis={analyses ? "" : undefined}
                data-hidden-interview={analyses ? undefined : ""}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-ed-line py-3 sm:grid-cols-[40px_minmax(0,1fr)_9rem_auto] sm:gap-x-5"
              >
                <span aria-hidden className="ed-mono row-span-2 self-start pt-0.5 text-[13px] text-ed-ink-3 sm:row-span-1 sm:self-center sm:pt-0">
                  {row.n}
                </span>
                <p className="min-w-0 break-words">
                  <span className="font-medium text-ed-ink">{row.company}</span>
                  <span className="block text-ed-small text-ed-ink-2">{row.title}</span>
                </p>
                <time dateTime={row.dateTime} className="ed-mono col-start-2 row-start-2 text-[13.5px] text-ed-ink-2 sm:col-start-auto sm:row-start-auto">
                  {row.date}
                </time>
                <button
                  type="button"
                  onClick={(event) => open({ kind: "one", row }, event.currentTarget)}
                  aria-label={row.deleteLabel}
                  className={buttonClass({ variant: "ghost", size: "sm", className: "col-start-3 row-span-2 row-start-1 sm:col-start-auto sm:row-span-1 sm:row-start-auto" })}
                >
                  {deleteRow}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
        {...dialog}
        pendingLabel={pendingLabel}
        pending={pending}
        onConfirm={confirm}
        onCloseAutoFocus={(event) => {
          const to = focusOutcome.current ? outcomeRef.current : openerRef.current;
          focusOutcome.current = false;
          if (!to?.isConnected) return;
          event.preventDefault();
          to.focus();
        }}
      />
    </div>
  );
}
