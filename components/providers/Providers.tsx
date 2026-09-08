"use client";

import { Toaster } from "@/components/ui/sonner";

type ProvidersProps = {
  children: React.ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <>
      {children}
      <Toaster
        theme="light"
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
