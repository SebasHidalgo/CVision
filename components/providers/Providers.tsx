"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";

type ProvidersProps = {
  children: React.ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  const queryClient = new QueryClient();

  return (
    <>
      <Toaster richColors />
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </>
  );
}
