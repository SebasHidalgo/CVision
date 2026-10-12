"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type RefreshPollerProps = {
  intervalMs?: number;
  /** Stop polling after this long; the page then tells the user to reload. */
  maxMs?: number;
};

/**
 * Re-renders the server component on an interval while feedback is being
 * generated. A refresh re-reads the status; once it is COMPLETED or FAILED
 * the screen renders something else and this unmounts.
 */
export default function RefreshPoller({
  intervalMs = 3_000,
  maxMs = 120_000,
}: RefreshPollerProps) {
  const router = useRouter();

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > maxMs) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs, maxMs]);

  return null;
}
