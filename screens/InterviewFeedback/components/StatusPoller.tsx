"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  interviewStatusSnapshotSchema,
  type InterviewStatusSnapshot,
} from "@/lib/schemas/interviewSessionSchema";
import { POLL_CEILING_MS, pollDelayMs } from "@/lib/pollDelay";

type StatusPollerProps = {
  interviewId: string;
  /** What the page rendered with; a poll that reads the same thing changes nothing. */
  seen: Pick<InterviewStatusSnapshot, "status" | "hasFeedback" | "failureReason">;
  /** Where the attempts of this interview are listed, for the stalled notice. */
  attemptsHref: string;
  /** The waiting copy, shown until the ceiling. */
  children: React.ReactNode;
};

const rendersDifferently = (
  a: StatusPollerProps["seen"],
  b: StatusPollerProps["seen"],
) => a.status !== b.status || a.hasFeedback !== b.hasFeedback || a.failureReason !== b.failureReason;

/**
 * Polls the status endpoint with backoff and re-renders the server component
 * once, when the answer would render differently. A poll is a small JSON
 * read; the render it replaces was a full page, a database read and a
 * feedback claim that changed nothing. The backoff clock restarts on a
 * change, since a change means the next one is probably close. The ceiling
 * does not: an hour after the page was opened the polling stops and the
 * page says so, because by then the reconcile fallback has run many times
 * and a wait that long is a failure to show, not to hide.
 */
export default function StatusPoller({ interviewId, seen, attemptsHref, children }: StatusPollerProps) {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);

  // Read through a ref so the polling loop below is tied to the interview,
  // not to the identity of the router object: a re-render must not restart
  // the clock.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const mountedAt = Date.now();
    let startedAt = mountedAt;
    const last = { ...seen };

    const schedule = () => {
      if (cancelled) return;
      const delay = pollDelayMs(Date.now() - startedAt);
      if (Date.now() + delay - mountedAt > POLL_CEILING_MS) {
        setStalled(true);
        return;
      }
      timer = window.setTimeout(tick, delay);
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
            routerRef.current.refresh();
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
  }, [interviewId]);

  if (!stalled) return <>{children}</>;

  return (
    <>
      <p className="flex items-center gap-3 text-lg text-ink">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-fair" />
        Your feedback is taking longer than expected.
      </p>
      <p className="lede mt-4 max-w-xl">Reload to check again, or come back later.</p>
      <Link
        href={attemptsHref}
        className="link-rule mt-6 inline-flex items-center gap-2 text-sm font-medium text-ink"
      >
        See every attempt
        <ArrowRight className="size-4" />
      </Link>
    </>
  );
}
