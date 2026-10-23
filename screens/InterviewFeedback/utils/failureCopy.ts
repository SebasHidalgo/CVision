import { FEEDBACK_FAILURE_REASONS } from "@/lib/ai/interviewFeedback";
import { CALL_FAILED } from "@/lib/elevenlabs/postCall";

/** Plain words for `Interview.failureReason`, and what is left to do. */
export type FailureCopy = {
  title: string;
  body: string;
  /** The generator can run again on the stored transcript. */
  canRetryFeedback: boolean;
};

const COPY: Record<string, FailureCopy> = {
  [FEEDBACK_FAILURE_REASONS.noCandidateTurns]: {
    title: "The interviewer never heard you.",
    body: "Every connection ended without a single answer from you, which usually means the microphone was muted or not allowed. Check the browser's microphone permission, then rehearse again from the analysis.",
    canRetryFeedback: false,
  },
  [CALL_FAILED]: {
    title: "The interviewer couldn't join the call.",
    body: "The voice platform could not run the call: a problem on our side, not with your microphone. Nothing was charged, and that connection did not count as one of your starts. Rehearse again from the analysis.",
    canRetryFeedback: false,
  },
  [FEEDBACK_FAILURE_REASONS.transcriptInvalid]: {
    title: "The transcript couldn't be read.",
    body: "What came back from the interview wasn't in a shape we can score. Rehearse again from the analysis; if it happens twice, something is wrong on our side.",
    canRetryFeedback: false,
  },
  [FEEDBACK_FAILURE_REASONS.contextMissing]: {
    title: "There's no analysis to score against.",
    body: "The feedback compares your answers with the gaps the analysis found, and this interview has no analysis any more. Run a new analysis and rehearse from there.",
    canRetryFeedback: false,
  },
  [FEEDBACK_FAILURE_REASONS.feedbackFailed]: {
    title: "We couldn't generate your feedback.",
    body: "Your interview is saved. Scoring it failed twice, which is usually the analyzer being unavailable. Try again now, or in a few minutes.",
    canRetryFeedback: true,
  },
};

const EXPIRED: FailureCopy = {
  title: "This interview expired.",
  body: "More than two hours passed since its last connection without the interviewer hearing an answer, so it was closed and the interview went back to your plan. Rehearse again from the analysis.",
  canRetryFeedback: false,
};

const UNKNOWN: FailureCopy = {
  title: "This interview didn't complete.",
  body: "Something went wrong on our side and we couldn't score it. Rehearse again from the analysis.",
  canRetryFeedback: false,
};

export function failureCopy(status: string, reason: string | null): FailureCopy {
  if (status === "EXPIRED") return EXPIRED;
  return (reason && COPY[reason]) || UNKNOWN;
}
