"use client";

import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";

type ProvidersProps = {
  children: React.ReactNode;
};

// The theme preference the removed dark mode kept in returning browsers.
const OLD_THEME_KEY = "cvision-theme";

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
      <Toaster
        position="bottom-center"
        toastOptions={{
          classNames: {
            toast: "font-sans shadow-float",
            title: "font-medium",
          },
        }}
      />
    </>
  );
}
