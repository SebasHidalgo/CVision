"use client";

import { useEffect } from "react";
import { fontText } from "@/components/design-system/fonts";
import { Toaster } from "@/components/ui/sonner";

type ProvidersProps = {
  children: React.ReactNode;
};

// The theme preference the removed dark mode kept in returning browsers.
const OLD_THEME_KEY = "cvision-theme";

// Sonner's colours are variables on its list; this replaces the shadcn wrapper's (which point at old tokens).
const TOAST_COLORS = {
  "--normal-bg": "var(--color-ed-raise)",
  "--normal-text": "var(--color-ed-ink)",
  "--normal-border": "var(--color-ed-line-2)",
  "--border-radius": "var(--radius-ed-surface)",
} as React.CSSProperties;

export default function Providers({ children }: ProvidersProps) {
  useEffect(() => {
    try {
      window.localStorage.removeItem(OLD_THEME_KEY);
    } catch {
      // Storage blocked: nothing was kept either.
    }
  }, []);

  return (
    <>
      {children}
      {/* Sonner's own sheet is unlayered, so the type and the edge override it with `!`. */}
      <Toaster
        theme="dark"
        position="bottom-center"
        className={fontText.variable}
        style={TOAST_COLORS}
        toastOptions={{
          classNames: {
            toast: "font-ed-text text-ed-small! shadow-ed-surface!",
            title: "font-medium",
            description: "text-ed-ink-2!",
          },
        }}
      />
    </>
  );
}
