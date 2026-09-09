"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  className?: string;
};

const ICON =
  "absolute size-[18px] transition-all duration-500 ease-out-expo";

/** Light ↔ dark. The switch itself crossfades the page via View Transitions. */
export default function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is unknown during SSR; render the slot, not a wrong icon.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === "dark";

  const toggle = () => {
    const next = dark ? "light" : "dark";

    const apply = () => {
      // Flip the class synchronously so the transition snapshots the change;
      // next-themes then persists it and sets the same class.
      document.documentElement.classList.toggle("dark", next === "dark");
      document.documentElement.style.colorScheme = next;
      setTheme(next);
    };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && typeof document.startViewTransition === "function") {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  };

  if (!mounted) {
    return <span aria-hidden className={cn("block size-9", className)} />;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative flex size-9 cursor-pointer items-center justify-center rounded-md text-ink-2 transition-colors duration-200 hover:bg-paper-2 hover:text-ink",
        className,
      )}
    >
      <Sun
        aria-hidden
        className={cn(ICON, dark ? "scale-50 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100")}
      />
      <Moon
        aria-hidden
        className={cn(ICON, dark ? "scale-100 rotate-0 opacity-100" : "scale-50 -rotate-90 opacity-0")}
      />
    </button>
  );
}
