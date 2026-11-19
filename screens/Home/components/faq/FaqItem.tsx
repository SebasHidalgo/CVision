"use client";

import { useId, useState } from "react";
import { ordinal } from "@/lib/format";

// Closed, the visibility flip waits for the height to finish; open, it is immediate. Reduced motion drops both.
const PANEL =
  "invisible grid grid-rows-[0fr] [transition:grid-template-rows_380ms_var(--ease-settle),visibility_0s_linear_380ms] " +
  "group-data-[open]/faq:visible group-data-[open]/faq:grid-rows-[1fr] " +
  "group-data-[open]/faq:[transition:grid-template-rows_380ms_var(--ease-settle),visibility_0s_linear_0s] motion-reduce:transition-none!";
const ANSWER =
  "max-w-[76ch] pr-8 pb-[22px] pl-14 text-ink-2 opacity-0 -translate-y-1.5 max-sm:px-0 " +
  "[transition:opacity_200ms_ease,translate_380ms_var(--ease-settle)] " +
  "group-data-[open]/faq:translate-y-0 group-data-[open]/faq:opacity-100 " +
  "group-data-[open]/faq:[transition:opacity_300ms_ease_80ms,translate_380ms_var(--ease-settle)] motion-reduce:transition-none!";

/**
 * One question: a real button with aria-expanded, and the answer always in the DOM. Its row animates 0fr to 1fr
 * while the text fades and settles, both ways; closed, it is visibility: hidden, out of the tab order and the
 * accessibility tree.
 */
export function FaqItem({ index, question, answer }: { index: number; question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div data-open={open || undefined} className="group/faq border-b border-line last:border-b-0">
      <h3>
        <button
          type="button"
          id={`${id}-q`}
          aria-expanded={open}
          aria-controls={`${id}-a`}
          onClick={() => setOpen((v) => !v)}
          className="group/btn grid w-full cursor-pointer grid-cols-[44px_minmax(0,1fr)_20px] items-baseline gap-3 py-[18px] text-left text-[18px] leading-[1.35] font-medium max-sm:grid-cols-[34px_minmax(0,1fr)_16px] max-sm:text-[16.5px]"
        >
          <span aria-hidden className="mono text-[13px] font-normal text-ink-3">
            {ordinal(index)}
          </span>
          <span className="decoration-1 underline-offset-[5px] group-hover/btn:underline">{question}</span>
          <span aria-hidden className="relative size-3.5 self-center">
            <span className="absolute top-[6.25px] left-0 h-[1.5px] w-3.5 bg-ink-2" />
            <span className="absolute top-[6.25px] left-0 h-[1.5px] w-3.5 rotate-90 bg-ink-2 transition-transform duration-[380ms] ease-settle group-data-[open]/faq:rotate-0 motion-reduce:transition-none" />
          </span>
        </button>
      </h3>
      <div id={`${id}-a`} className={PANEL}>
        <div className="min-h-0 overflow-hidden">
          <p className={ANSWER}>{answer}</p>
        </div>
      </div>
    </div>
  );
}
