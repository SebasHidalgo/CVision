import type { InterviewStatus } from "@prisma/client";

/**
 * What a status means for navigation. Three screens route on it (the list,
 * the analysis CTA and the room), so it lives here rather than in any one of
 * them. `finalized` is gone from the decision: it only ever meant COMPLETED.
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

const LABEL: Record<InterviewPhase, string> = {
  ready: "Open the interview room",
  pending: "Preparing your feedback",
  done: "Read interview feedback",
  failed: "See what went wrong",
  expired: "Interview expired",
};

/** Where a link to this interview should go, and what it should say. */
export function interviewDestination(interview: {
  id: string;
  status: InterviewStatus;
}): { href: string; label: string; phase: InterviewPhase } {
  const phase = interviewPhase(interview.status);
  const href = phase === "ready" ? `/interview/${interview.id}` : `/interview/${interview.id}/feedback`;
  return { href, label: LABEL[phase], phase };
}
