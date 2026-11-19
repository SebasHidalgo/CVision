"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/useMediaQuery";

// The band, as a share of the viewport's height, whose crossing makes a step the current one: just above the middle.
const BAND_TOP = 0.45;
const BAND_BOTTOM = 0.5;
// A jump releases at `scrollend`; this is the fallback for browsers without it, or a jump with nothing to scroll.
const JUMP_RELEASE_MS = 1200;

/**
 * The step being read, for the story's narration, index and object. The current step is the one whose text crosses
 * the band above the middle of the screen; a chapter button jumps to its step and moves focus to its heading.
 * Also fills the index's line (`--p` on the rail element, 0 to 1) as the reader moves from the first step to the last.
 */
export function useActiveStep(count: number) {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const steps =useRef<(HTMLElement | null)[]>([]);
  const rail = useRef<HTMLElement | null>(null);
  // Set while a chapter button scrolls the page: the steps passed on the way don't take over the object.
  const jump = useRef<{ timer: number; end: () => void } | null>(null);

  // One stable ref callback per step, so a render never detaches and re-attaches them.
  const stepRefs = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => (el: HTMLElement | null) => {
        steps.current[i] = el;
      }),
    [count],
  );

  const syncToBand = useCallback(() => {
    const top = window.innerHeight * BAND_TOP;
    const bottom = window.innerHeight * BAND_BOTTOM;
    const i = steps.current.findIndex((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top < bottom && r.bottom > top;
    });
    if (i >= 0) setActive(i);
  }, []);

  const endJump = useCallback(
    (resync: boolean) => {
      const current = jump.current;
      if (!current) return;
      window.clearTimeout(current.timer);
      window.removeEventListener("scrollend", current.end);
      jump.current = null;
      if (resync) syncToBand();
    },
    [syncToBand],
  );

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (jump.current) return;
        for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.i));
      },
      { rootMargin: `-${BAND_TOP * 100}% 0px -${BAND_BOTTOM * 100}% 0px` },
    );
    for (const el of steps.current) if (el) io.observe(el);
    return () => {
      io.disconnect();
      endJump(false);
    };
  }, [count, endJump]);

  // The index's line fills continuously, from the first step's middle to the last one's, with no render per frame.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = rail.current;
      const first = steps.current[0];
      const last = steps.current[count - 1];
      // offsetParent is null while the index is hidden (phones, reduced motion): nothing to fill.
      if (!el || !first || !last || el.offsetParent === null) return;
      const mid = (step: HTMLElement) => {
        const r = step.getBoundingClientRect();
        return r.top + r.height / 2;
      };
      const a = mid(first);
      const b = mid(last);
      const p = Math.min(1, Math.max(0, (window.innerHeight / 2 - a) / Math.max(1, b - a)));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [count]);

  const go = useCallback(
    (i: number) => {
      const el = steps.current[i];
      if (!el) return;
      endJump(false);
      const end = () => endJump(true);
      jump.current = { timer: window.setTimeout(end, JUMP_RELEASE_MS), end };
      window.addEventListener("scrollend", end);
      setActive(i);
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      el.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
    },
    [endJump, reduce],
  );

  return { active, go, stepRefs, railRef: rail };
}
