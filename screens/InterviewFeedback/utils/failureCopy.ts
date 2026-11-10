import { FEEDBACK_FAILURE_REASONS } from "@/lib/ai/interviewFeedback";
import { CALL_FAILED } from "@/lib/elevenlabs/postCall";

/** Which explanation a failed interview gets: its title and body live under `failure.<kind>` (feedback namespace). */
export type FailureKind =
  | "noCandidateTurns"
  | "callFailed"
  | "transcriptInvalid"
  | "contextMissing"
  | "feedbackFailed"
  | "expired"
  | "unknown";

/** Plain words for `Interview.failureReason`, and what is left to do. */
export type FailureCopy = {
  kind: FailureKind;
  /** The generator can run again on the stored transcript. */
  canRetryFeedback: boolean;
};

const COPY: Record<string, FailureCopy> = {
  [FEEDBACK_FAILURE_REASONS.noCandidateTurns]: { kind: "noCandidateTurns", canRetryFeedback: false },
  [CALL_FAILED]: { kind: "callFailed", canRetryFeedback: false },
  [FEEDBACK_FAILURE_REASONS.transcriptInvalid]: { kind: "transcriptInvalid", canRetryFeedback: false },
  [FEEDBACK_FAILURE_REASONS.contextMissing]: { kind: "contextMissing", canRetryFeedback: false },
  [FEEDBACK_FAILURE_REASONS.feedbackFailed]: { kind: "feedbackFailed", canRetryFeedback: true },
};

const EXPIRED: FailureCopy = { kind: "expired", canRetryFeedback: false };

const UNKNOWN: FailureCopy = { kind: "unknown", canRetryFeedback: false };

export function failureCopy(status: string, reason: string | null): FailureCopy {
  if (status === "EXPIRED") return EXPIRED;
  return (reason && COPY[reason]) || UNKNOWN;
}
