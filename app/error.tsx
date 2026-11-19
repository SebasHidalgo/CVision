"use client";

import ErrorScreen from "@/screens/Error/ErrorScreen";

// The root boundary: the landing, or the app's shell itself (its header reads the session and the plan), failed.
// It renders inside the root layout, without the shell, so the screen draws its own band.
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} variant="bare" />;
}
