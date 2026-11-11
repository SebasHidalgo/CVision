import type { InterviewStatus } from "@prisma/client";

/**
 * What a status means for navigation. Three screens route on it (the list,
 * the analysis CTA and the room), so it lives here rather than in any one of
 * them.
 *
 *   ready    the room: nothing scoreable yet
 *   pending  the feedback page, which generates and polls
 *   done     the feedback page
 *   failed   the feedback page, which says why and offers what is left
 *   expired  the feedback page, which says so (nothing sets it yet)
 */
export type InterviewPhase = "ready" | "pending" | "done" | "failed" | "expired";

export function interviewPhase(status: InterviewStatus): InterviewPhase {
  switch (status) {
    case "SCHEDULED":
    case "IN_PROGRESS":
      return "ready";
    case "FEEDBACK_PENDING":
    case "GENERATING":
      return "pending";
    case "COMPLETED":
      return "done";
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
  }
}

/** What a link to an interview says, by phase: keys of the `interview` namespace. */
const LABEL_KEY = {
  ready: "destination.ready",
  pending: "destination.pending",
  done: "destination.done",
  failed: "destination.failed",
  expired: "destination.expired",
} as const satisfies Record<InterviewPhase, string>;

export type InterviewDestinationLabelKey = (typeof LABEL_KEY)[InterviewPhase];

/**
 * The failure reasons the feedback step writes (lib/ai/interviewFeedback.ts): the candidate
 * answered and only the scoring failed. Every other FAILED interview (nothing said, the call lost
 * or never run) did not happen as a rehearsal.
 */
export const FAILED_AFTER_ANSWERS: ReadonlySet<string> = new Set(["FEEDBACK_FAILED", "TRANSCRIPT_INVALID", "CONTEXT_MISSING"]);

/**
 * Whether an attempt was a rehearsal that actually ran: the candidate answered. Scheduled,
 * in-progress, expired and never-answered attempts do not count, so "again" is never said about a
 * rehearsal that never happened.
 */
export function attemptRan(attempt: { status: InterviewStatus; failureReason: string | null }): boolean {
  switch (interviewPhase(attempt.status)) {
    case "pending":
    case "done":
      return true;
    case "failed":
      return attempt.failureReason !== null && FAILED_AFTER_ANSWERS.has(attempt.failureReason);
    case "ready":
    case "expired":
      return false;
  }
}

/** The one attempt of an analysis that can still be started, if any. */
export function liveAttempt<T extends { status: InterviewStatus }>(attempts: T[]): T | null {
  return attempts.find((attempt) => interviewPhase(attempt.status) === "ready") ?? null;
}

/** Where a link to this interview should go, and the `interview`-namespace key of what it says. */
export function interviewDestination(interview: {
  id: string;
  status: InterviewStatus;
}): { href: string; labelKey: InterviewDestinationLabelKey; phase: InterviewPhase } {
  const phase = interviewPhase(interview.status);
  const href = phase === "ready" ? `/interview/${interview.id}` : `/interview/${interview.id}/feedback`;
  return { href, labelKey: LABEL_KEY[phase], phase };
}
