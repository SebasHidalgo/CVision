"use client";

import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "@/screens/Home/hooks/useMediaQuery";
import { isLoading, REVEALED_EVENT } from "@/lib/bootScript";

/**
 * When the hero's reading may play. While the loader is up (`data-loading` on <html>) it waits: it starts on the
 * loader's reveal event, or when the attribute goes away, whichever comes first; without a loader it starts at once.
 * The headline's rise is CSS and keys on the same attribute (paused under `data-loading`), so the two start together.
 */
export function useHeroSequence() {
  const reduce = useReducedMotion();
  const [started, setStarted] = useState(false);
  // Bumped by "replay": the figure restarts its reading from zero.
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!isLoading()) {
      setStarted(true);
      return;
    }
    const start = () => setStarted(true);
    window.addEventListener(REVEALED_EVENT, start, { once: true });
    const html = document.documentElement;
    const watch = new MutationObserver(() => {
      if (!isLoading()) start();
    });
    watch.observe(html, { attributes: true, attributeFilter: ["data-loading"] });
    return () => {
      window.removeEventListener(REVEALED_EVENT, start);
      watch.disconnect();
    };
  }, []);

  const replay = useCallback(() => setRun((r) => r + 1), []);

  return { started, run, replay, reduce };
}
