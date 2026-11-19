"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/design-system/Logo";
import { DURATION, EASE } from "@/components/design-system/motion";
import { cn } from "@/lib/utils";
import { isLoading, reveal, REVEALED_EVENT } from "@/lib/bootScript";
import { markReady, onReady, READY_SIGNALS } from "@/screens/Home/utils/readiness";

const MARKS = READY_SIGNALS.length;
const TRAVEL_MS = DURATION.slow;

/** The six marks' landing places in the hero, in order, if all six are on screen. */
function heroTargets(): DOMRect[] | null {
  const rects = [...document.querySelectorAll<HTMLElement>("[data-loader-mark]")]
    .map((el) => ({ i: Number(el.dataset.loaderMark), rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight)
    .sort((a, b) => a.i - b.i)
    .map(({ rect }) => rect);
  return rects.length === MARKS ? rects : null;
}

/**
 * The landing's full-page loader: one mark fills per readiness signal; when all six are in, the row travels into the
 * hero's legend while the page appears around it. Shown only on full loads of the landing (the boot script raises it);
 * the boot script's cap reveals the page whatever is ready.
 */
export function PageLoader() {
  const { t } = useTranslation("landing");
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const marks = useRef<(HTMLSpanElement | null)[]>([]);
  const ground = useRef<HTMLDivElement>(null);
  const brand = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading()) {
      setDone(true);
      return;
    }
    setAnnounce(true);
    document.fonts?.ready.then(() => markReady("fonts")).catch(() => markReady("fonts"));
    const seen = new Set<string>();
    const off = onReady((signal) => {
      seen.add(signal);
      setCount(seen.size);
    });
    const onRevealed = () => setDone(true);
    window.addEventListener(REVEALED_EVENT, onRevealed);
    return () => {
      off();
      window.removeEventListener(REVEALED_EVENT, onRevealed);
    };
  }, []);

  useEffect(() => {
    if (count < MARKS || done || !isLoading()) return;
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = reduce ? null : heroTargets();
    if (!targets) {
      reveal();
      return;
    }
    root.setAttribute("data-loading", "travel");
    const options = { duration: TRAVEL_MS, easing: EASE.out, fill: "forwards" as const };
    const moves = marks.current.map((el, i) => {
      if (!el) return null;
      const from = el.getBoundingClientRect();
      const to = targets[i];
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const scale = to.width / from.width;
      return el.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }], options);
    });
    ground.current?.animate([{ opacity: 1 }, { opacity: 0 }], { ...options, duration: TRAVEL_MS * 0.75 });
    brand.current?.animate([{ opacity: 1 }, { opacity: 0 }], { ...options, duration: TRAVEL_MS * 0.4 });
    const last = moves.find(Boolean);
    let cancelled = false;
    (last?.finished ?? Promise.resolve()).then(
      () => !cancelled && reveal(),
      () => !cancelled && reveal(),
    );
    return () => {
      cancelled = true;
    };
  }, [count, done]);

  if (done) return null;

  return (
    <div
      data-loader
      role="status"
      className="fixed inset-0 z-50 hidden place-items-center [html[data-loading]_&]:grid"
    >
      <div ref={ground} aria-hidden className="absolute inset-0 bg-bg" />
      <div className="relative grid justify-items-center gap-7">
        <div ref={brand} aria-hidden>
          <Logo className="scale-125" />
        </div>
        <div aria-hidden className="flex gap-2.5">
          {READY_SIGNALS.map((signal, i) => (
            <span
              key={signal}
              ref={(el) => {
                marks.current[i] = el;
              }}
              data-on={i < count ? "" : undefined}
              className={cn(
                "size-[11px] border-[1.5px] border-ink-2 transition-[background-color,border-color] duration-200 ease-out motion-reduce:transition-none",
                "data-[on]:border-ink data-[on]:bg-ink",
              )}
            />
          ))}
        </div>
        <span className="sr-only">{announce ? t("loader.label") : ""}</span>
      </div>
    </div>
  );
}
