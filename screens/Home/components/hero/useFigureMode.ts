"use client";

import { useEffect, useRef, useState } from "react";
import { hasHardwareWebGL } from "@/screens/Home/components/background/gpu";

/** compact: the HTML figure for phones and tablets. scene: the 3D figure. flat: the HTML figure on a desktop. */
export type FigureMode = "compact" | "scene" | "flat";

const WIDE = "(min-width: 64rem)";
const REDUCE = "(prefers-reduced-motion: reduce)";

/**
 * Which figure the hero draws; null until mounted (the server cannot know the screen). The 3D scene only at 1024 px
 * and wider, with motion allowed, a hardware GPU, and while it has not failed. Reads the media queries itself: the
 * shared media hooks answer false during hydration, which would mount the scene on a reduced-motion desktop.
 */
export function useFigureMode(failed: boolean): FigureMode | null {
  const [mode, setMode] = useState<FigureMode | null>(null);
  const gpu = useRef<boolean | null>(null);

  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const reduce = window.matchMedia(REDUCE);
    const decide = () => {
      if (!wide.matches) {
        setMode("compact");
      } else if (reduce.matches || failed) {
        setMode("flat");
      } else {
        gpu.current ??= hasHardwareWebGL();
        setMode(gpu.current ? "scene" : "flat");
      }
    };
    decide();
    wide.addEventListener("change", decide);
    reduce.addEventListener("change", decide);
    return () => {
      wide.removeEventListener("change", decide);
      reduce.removeEventListener("change", decide);
    };
  }, [failed]);

  return mode;
}
