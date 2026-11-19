"use client";

import { useEffect } from "react";
import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert } from "lucide-react";
import { Toaster } from "sonner";
import { fontText } from "@/components/design-system/fonts";

type ProvidersProps = {
  children: React.ReactNode;
};

// The theme preference the removed dark mode kept in returning browsers.
const OLD_THEME_KEY = "cvision-theme";

// Sonner's colours are variables on its list, set from the design system.
const TOAST_COLORS = {
  "--normal-bg": "var(--color-raise)",
  "--normal-text": "var(--color-ink)",
  "--normal-border": "var(--color-line-2)",
  "--border-radius": "var(--radius-surface)",
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
        icons={{
          success: <CircleCheck className="size-4" />,
          info: <Info className="size-4" />,
          warning: <TriangleAlert className="size-4" />,
          error: <OctagonX className="size-4" />,
          loading: <Loader2 className="size-4 animate-spin" />,
        }}
        toastOptions={{
          classNames: {
            toast: "font-text text-small! shadow-surface!",
            title: "font-medium",
            description: "text-ink-2!",
          },
        }}
      />
    </>
  );
}
