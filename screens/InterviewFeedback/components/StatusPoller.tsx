"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  interviewStatusSnapshotSchema,
  type InterviewStatusSnapshot,
} from "@/lib/schemas/interviewSessionSchema";
import { pollDelayMs } from "../utils/pollDelay";

type StatusPollerProps = {
  interviewId: string;
  /** What the page rendered with; a poll that reads the same thing changes nothing. */
  seen: Pick<InterviewStatusSnapshot, "status" | "hasFeedback" | "failureReason">;
};

const rendersDifferently = (
  a: StatusPollerProps["seen"],
  b: StatusPollerProps["seen"],
) => a.status !== b.status || a.hasFeedback !== b.hasFeedback || a.failureReason !== b.failureReason;

/**
 * Polls the status endpoint with backoff and re-renders the server component
 * once, when the answer would render differently. A poll is a small JSON
 * read; the render it replaces was a full page, a database read and a
 * feedback claim that changed nothing. The clock restarts on a change, since
 * a change means the next one is probably close. No hard stop: a wait that
 * never resolves is ended by the server's reconcile fallback, which the
 * status endpoint itself runs.
 */
export default function StatusPoller({ interviewId, seen }: StatusPollerProps) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let startedAt = Date.now();
    const last = { ...seen };

    const schedule = () => {
      if (cancelled) return;
      timer = window.setTimeout(tick, pollDelayMs(Date.now() - startedAt));
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/interview/${encodeURIComponent(interviewId)}/status`, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        // Signed out or gone: nothing a poll can wait for.
        if (response.status === 401 || response.status === 404) return;

        const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
        if (body?.ok === true) {
          const parsed = interviewStatusSnapshotSchema.safeParse(body.data);
          if (parsed.success && rendersDifferently(last, parsed.data)) {
            Object.assign(last, parsed.data);
            startedAt = Date.now();
            router.refresh();
          }
        }
      } catch {
        // A transient failure; the next poll tries again.
      }
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // `seen` is the baseline for this mount only; later renders of the same
    // pending page keep the running baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId, router]);

  return null;
}
