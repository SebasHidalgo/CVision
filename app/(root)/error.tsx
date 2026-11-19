"use client";

import ErrorScreen from "@/screens/Error/ErrorScreen";

// An app page failed: the shell's header and footer stay around the error.
export default function AppPageError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} variant="shell" />;
}
