"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

type ProvidersProps = {
  children: React.ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    // Class on <html>, applied by an inline script before first paint, so no
    // flash of the wrong theme. Persists in localStorage.
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="cvision-theme"
    >
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
    </ThemeProvider>
  );
}
