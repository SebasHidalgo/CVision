"use client";

// The silk ground's canvas and its life. Loaded after the page paints; until it draws, the plain canvas colour shows.
//
// React's development mode runs every effect twice on the same canvas. A canvas keeps one context for its whole life,
// so a cleanup never gives that context back: the second run would get the dead one, which the browser paints white.
// The context is released only once the canvas has really left the page.

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/useMediaQuery";
import { markReady } from "@/screens/Home/utils/readiness";
import { createSilkEngine, STILL_T, STILL_URL, type SilkEngine } from "./silkEngine";

/** True while the watched element is on screen; true when no element matches (the ground then always moves). */
function useWatchedOnScreen(selector: string) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [selector]);
  return on;
}

export default function SilkGround({ watch }: { watch: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const active = useWatchedOnScreen(watch);
  const live = useRef({ active, reduce });
  const kick = useRef<() => void>(() => undefined);
  // No engine can draw (no WebGL, a shader that will not build, a context the GPU took back): the still image shows.
  const [still, setStill] = useState(false);
  // Bumped when the browser restores a lost context, so the engine is built again on it.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const el = canvas.current;
    const wrap = box.current;
    if (!el || !wrap) return;
    let engine: SilkEngine | null = null;
    try {
      engine = createSilkEngine(el);
    } catch (error) {
      console.error("[CVision][silk] the ground could not be built; showing its still", error);
    }
    if (!engine) {
      setStill(true);
      return;
    }
    setStill(false);
    const e = engine;
    let t = STILL_T;
    let raf = 0;
    let last = 0;
    let running = false;
    let shown = false;
    const draw = () => {
      e.draw(t);
      if (!shown) {
        shown = true;
        requestAnimationFrame(() => markReady("silk-frame"));
      }
    };
    const holdStill = () => live.current.reduce || e.software;
    const shouldRun = () => live.current.active && !document.hidden && !holdStill();
    const frame = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      draw();
      if (shouldRun()) raf = requestAnimationFrame(frame);
      else {
        running = false;
        last = 0;
      }
    };
    const start = () => {
      if (holdStill()) {
        t = STILL_T;
        draw();
        return;
      }
      if (running || !shouldRun()) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    kick.current = start;
    // Sized to its own box; a resize redraws the current frame at once.
    const ro = new ResizeObserver(([entry]) => {
      e.resize(entry.contentRect.width, entry.contentRect.height);
      draw();
    });
    ro.observe(wrap);
    const onVisibility = () => start();
    document.addEventListener("visibilitychange", onVisibility);
    const onLost = (ev: Event) => {
      // Asks the browser to restore it; the still covers the wait.
      ev.preventDefault();
      cancelAnimationFrame(raf);
      running = false;
      kick.current = () => undefined;
      setStill(true);
    };
    const onRestored = () => setEpoch((n) => n + 1);
    el.addEventListener("webglcontextlost", onLost);
    el.addEventListener("webglcontextrestored", onRestored);
    start();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      el.removeEventListener("webglcontextlost", onLost);
      el.removeEventListener("webglcontextrestored", onRestored);
      kick.current = () => undefined;
      e.dispose();
      // Development's second run keeps this canvas on the page and builds on the same, still living, context.
      setTimeout(() => {
        if (!el.isConnected) e.release();
      }, 0);
    };
  }, [epoch]);

  // The hero coming back into view, or a change of motion preference, restarts (or stills) the loop.
  useEffect(() => {
    live.current = { active, reduce };
    kick.current();
  }, [active, reduce]);

  // The still counts as the ground's first frame once decoded (or failed: the loader never waits on it).
  useEffect(() => {
    if (!still) return;
    const img = new Image();
    img.src = STILL_URL;
    img
      .decode()
      .catch(() => undefined)
      .then(() => markReady("silk-frame"));
  }, [still]);

  return (
    <div
      ref={box}
      data-still={still ? "" : undefined}
      className="absolute inset-0 bg-cover bg-center"
      style={still ? { backgroundImage: `url(${STILL_URL})` } : undefined}
    >
      {/* One canvas for the ground's life: a canvas whose context was given back never gives a working one again. */}
      <canvas ref={canvas} className={still ? "invisible block size-full" : "block size-full"} />
    </div>
  );
}
