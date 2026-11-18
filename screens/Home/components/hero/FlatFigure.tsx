"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusMark } from "@/components/design-system/StatusMark";
import { REQUIREMENTS } from "@/screens/Home/utils/exampleCase";
import type { LocalizedCvLine, LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { cn } from "@/lib/utils";
import { proves, startTimes, T_SCAN0, T_SCAN1 } from "./heroTiming";
import { wirePath, type Wire } from "./wires";

type Props = {
  /** compact: phones and tablets, stacked and interactive. flat: the desktop fallback, side by side, a picture. */
  layout: "compact" | "flat";
  requirements: LocalizedRequirement[];
  cvLines: LocalizedCvLine[];
  company: string;
  candidate: string;
  started: boolean;
  run: number;
  reduce: boolean;
  /** The requirement stressed (hovered or pinned), and the pinned one; only the compact rows pin. */
  focus: string | null;
  pinned: string | null;
  onPin: (id: string) => void;
  /** The loader's marks land on this list's marks. */
  loaderTarget: boolean;
  /** The requirement sheet's bottom must sit in the first screen (phones). */
  heroFit: boolean;
  className?: string;
};

const STARTS = startTimes();
const PROVING = REQUIREMENTS.filter(proves);
const PROOF_LINES = new Set(PROVING.map((r) => r.line));

// Before a status lands. Only with JavaScript (the boot script's `data-js`) and motion: without either, the read state
// shows from the first paint.
const PENDING = {
  mark: "in-data-js:motion-safe:border-solid in-data-js:motion-safe:border-ed-ink-3 in-data-js:motion-safe:bg-transparent in-data-js:motion-safe:bg-none",
  label: "in-data-js:motion-safe:text-ed-ink-2",
  status: "in-data-js:motion-safe:opacity-0",
  proof: "in-data-js:motion-safe:bg-transparent in-data-js:motion-safe:shadow-none",
};

// On a desktop shorter than 760 px the side-by-side figure needs every row for the CV.
const HEAD_FLAT = "[@media(max-height:760px)]:hidden";

const LINE_KIND: Record<LocalizedCvLine["kind"], string> = {
  name: "font-ed-display font-light text-ed-ink [font-variation-settings:'opsz'_48,'SOFT'_0,'WONK'_0] text-[21px] leading-[1.2]",
  meta: "",
  head: "font-ed-mono text-[12px] uppercase tracking-[0.06em] text-ed-ink-3",
  role: "font-semibold text-ed-ink",
  text: "",
};

/**
 * The hero figure in HTML: the six requirements on one solid sheet, the CV on another, and the same reading as the 3D
 * figure (statuses landing in turn, a wire from each proving CV line to its requirement). The wires run in the space
 * between the sheets, where the page's ground shows.
 */
export function FlatFigure(props: Props) {
  const { layout, requirements, cvLines, company, candidate, started, run, reduce, focus, pinned, onPin, loaderTarget, heroFit, className } = props;
  const { t } = useTranslation("landingHero");
  const root = useRef<HTMLDivElement>(null);
  const scan = useRef<HTMLLIElement>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const [wires, setWires] = useState<Wire[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const flat = layout === "flat";

  // The wires follow the layout: measured again whenever the figure changes size, and once the fonts are in.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const origin = el.getBoundingClientRect();
      const sheet = el.querySelector<HTMLElement>("[data-sheet]")?.getBoundingClientRect();
      const cv = el.querySelector<HTMLElement>("[data-cv]")?.getBoundingClientRect();
      if (!sheet || !cv || origin.width === 0) return;
      const next: Wire[] = [];
      for (const r of PROVING) {
        const row = el.querySelector<HTMLElement>(`[data-req="${r.id}"]`)?.getBoundingClientRect();
        const line = el.querySelector<HTMLElement>(`[data-line="${r.line}"]`)?.getBoundingClientRect();
        if (row && line) next.push({ id: r.id, d: wirePath(origin, sheet, cv, row, line) });
      }
      setWires(next);
      setBox({ w: origin.width, h: origin.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => ro.disconnect();
  }, [layout]);

  // The reading: statuses land at the same times as in the 3D figure.
  useEffect(() => {
    if (reduce) {
      setDone(new Set(REQUIREMENTS.map((r) => r.id)));
      return;
    }
    setDone(new Set());
    if (!started) return;
    const timers = REQUIREMENTS.map((r, i) => window.setTimeout(() => setDone((prev) => new Set(prev).add(r.id)), STARTS[i] * 1000));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [started, run, reduce]);

  // The scan line down the CV, by WAAPI so it restarts with each replay.
  useEffect(() => {
    const el = scan.current;
    if (!el || !started || reduce) return;
    const animation = el.animate(
      [
        { transform: "translateY(0)", opacity: 0.6 },
        { opacity: 0.6, offset: 0.96 },
        { transform: "translateY(100%)", opacity: 0 },
      ],
      { duration: (T_SCAN1 - T_SCAN0) * 1000, delay: T_SCAN0 * 1000, easing: "linear", fill: "both" },
    );
    return () => animation.cancel();
  }, [started, run, reduce]);

  const proofNow = useMemo(() => new Set(PROVING.filter((r) => done.has(r.id)).map((r) => r.line)), [done]);

  return (
    <div
      ref={root}
      className={cn(
        "relative grid",
        flat ? "grid-cols-[minmax(0,5fr)_minmax(0,6fr)] grid-rows-[minmax(0,1fr)] gap-x-[clamp(64px,9vw,150px)] py-[clamp(6px,1.2svh,14px)]" : "gap-[18px] pl-6",
        className,
      )}
    >
      <div data-sheet data-hero={heroFit ? "" : undefined} className={cn("ed-surface", flat ? "flex min-h-0 flex-col px-4 pt-2.5 pb-1" : "px-3.5 pt-2 pb-0.5")}>
        <p
          className={cn(
            "flex justify-between gap-3 border-b border-ed-line pb-1.5 text-[12.5px] text-ed-ink-3",
            // A short screen keeps the rows: the sheet headings go first.
            flat ? HEAD_FLAT : "max-lg:[@media(max-height:700px)]:hidden",
          )}
        >
          <span>{t("figure.posting", { company })}</span>
          <span className="ed-mono">{t("figure.requirements", { count: requirements.length })}</span>
        </p>
        <ul
          aria-label={flat ? undefined : t("figure.listLabel")}
          aria-hidden={flat ? true : undefined}
          data-loader-target={loaderTarget ? "" : undefined}
          className={cn("grid", flat && "flex-1 grid-rows-[repeat(6,minmax(0,1fr))]")}
        >
          {requirements.map((r, i) => {
            const pending = !done.has(r.id);
            const content = (
              <>
                <span data-loader-mark={i} className="inline-flex">
                  <StatusMark
                    status={r.status}
                    className={cn("transition-[background-color,border-color] duration-[350ms] motion-reduce:transition-none", pending && PENDING.mark)}
                  />
                </span>
                <span className="ed-mono text-[12px] text-ed-ink-3">{r.n}</span>
                <span
                  className={cn(
                    "text-[15px] leading-[1.22] font-medium transition-colors duration-300 motion-reduce:transition-none",
                    focus && focus !== r.id ? "text-ed-ink-2" : "text-ed-ink",
                    pinned === r.id && "underline decoration-1 underline-offset-4",
                    pending && PENDING.label,
                  )}
                >
                  {r.label}
                </span>
                <span
                  aria-hidden
                  className={cn("text-[13px] whitespace-nowrap text-ed-ink-2 transition-opacity duration-300 motion-reduce:transition-none", pending && PENDING.status)}
                >
                  {r.statusShort}
                </span>
              </>
            );
            const row = "grid w-full grid-cols-[12px_26px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-ed-line text-left";
            return (
              <li key={r.id} className="flex [&:last-child>*]:border-b-0">
                {flat ? (
                  <div data-req={r.id} data-pending={pending ? "" : undefined} className={cn(row, "min-h-0")}>
                    {content}
                  </div>
                ) : (
                  <button
                    type="button"
                    data-req={r.id}
                    data-pending={pending ? "" : undefined}
                    aria-pressed={pinned === r.id}
                    onClick={() => onPin(r.id)}
                    className={cn(row, "min-h-11 cursor-pointer py-[3px]")}
                  >
                    {content}
                    <span className="sr-only">{`, ${r.statusLabel}`}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <svg
        aria-hidden
        focusable="false"
        width={box.w}
        height={box.h}
        viewBox={`0 0 ${box.w || 1} ${box.h || 1}`}
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
      >
        {wires.map((w) => (
          <path
            key={`${run}-${w.id}`}
            d={w.d}
            pathLength={1}
            className={cn(
              "fill-none stroke-ed-signal [stroke-dasharray:1] [stroke-width:1.25] transition-[stroke-dashoffset,opacity] duration-[450ms] ease-ed-out motion-reduce:transition-none",
              done.has(w.id) ? "[stroke-dashoffset:0]" : "[stroke-dashoffset:1]",
              focus && focus !== w.id && "opacity-25",
            )}
          />
        ))}
      </svg>

      <div data-cv aria-hidden className={cn("ed-surface", flat ? "flex min-h-0 flex-col overflow-hidden px-4 pt-2.5 pb-2" : "px-3.5 pt-3 pb-3.5")}>
        <p className={cn("flex justify-between gap-3 border-b border-ed-line pb-2 text-[12.5px] text-ed-ink-3", flat && HEAD_FLAT)}>
          <span>{t("figure.cv", { name: candidate })}</span>
          <span className="ed-mono">{t("figure.pages", { count: 1 })}</span>
        </p>
        <ol className={cn("relative mt-2 grid gap-px", flat && "min-h-0 flex-1 content-evenly")}>
          {cvLines.map((l) => {
            const proof = PROOF_LINES.has(l.n);
            return (
              <li
                key={l.n}
                data-line={l.n}
                className={cn(
                  "grid grid-cols-[22px_minmax(0,1fr)] items-baseline gap-2.5 py-[3px] pr-1.5 pl-1 text-[13.5px] leading-[1.35] text-ed-ink-2 transition-[background-color,box-shadow] duration-[400ms] motion-reduce:transition-none",
                  flat && "py-px",
                  proof && "bg-ed-signal-wash shadow-ed-proof",
                  proof && !proofNow.has(l.n) && PENDING.proof,
                )}
              >
                <span className="ed-mono text-[12px] text-ed-ink-3">{String(l.n).padStart(2, "0")}</span>
                <span className={cn("min-w-0", LINE_KIND[l.kind])}>{l.text}</span>
              </li>
            );
          })}
          <li ref={scan} className="pointer-events-none absolute inset-0 border-t border-ed-ink opacity-0" />
        </ol>
      </div>
    </div>
  );
}
