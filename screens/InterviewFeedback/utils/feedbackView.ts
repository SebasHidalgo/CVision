import type { InterviewStatus } from "@prisma/client";
import {
  isStranded,
  NO_CANDIDATE_TURNS,
  SESSION_LOST,
  type StrandedCandidate,
} from "@/lib/elevenlabs/postCall";
import { interviewPhase } from "@/lib/interviewStatus";

export type FeedbackView =
  /** Nothing to wait for here: the room is where this interview continues. */
  | { kind: "room" }
  /** Opened by hand while a call may still be running elsewhere. */
  | { kind: "live-notice" }
  /** The latest call produced nothing to score; the interview is still startable. */
  | { kind: "not-scored"; reason: "silent" | "lost" }
  /** The call is over and the transcript has not landed yet. */
  | { kind: "pending-transcript" }
  /** The transcript is stored and feedback is being generated. */
  | { kind: "pending-scoring" }
  | { kind: "failed" }
  | { kind: "report" };

export type FeedbackViewInput = StrandedCandidate & {
  status: InterviewStatus;
  failureReason: string | null;
  /** The room sent the candidate here the moment the call ended. */
  justEnded: boolean;
};

/**
 * What the feedback page shows for an interview, decided in one place. The
 * reconcile for a stranded interview has already run by the time this is
 * called, so "stranded" here means the platform still has nothing to give.
 *
 * The delicate case is a startable interview opened without `?ended=1`:
 * a call may be live in another tab, and bouncing to the room would offer a
 * Start that costs a start. So a session with no transcript is shown as
 * waiting (the room reported the end, or the call must be over) or as a
 * notice (it may still be running), never as the room.
 */
export function decideFeedbackView(
  input: FeedbackViewInput,
  now: Date,
  maxDurationSeconds: number,
): FeedbackView {
  const phase = interviewPhase(input.status);

  if (phase === "ready") {
    const silent = input.failureReason === NO_CANDIDATE_TURNS;
    const lost = input.failureReason === SESSION_LOST;
    if (silent || lost) {
      return input.justEnded ? { kind: "not-scored", reason: lost ? "lost" : "silent" } : { kind: "room" };
    }
    if (input.justEnded) return { kind: "pending-transcript" };

    const sessionOpen =
      input.status === "IN_PROGRESS" && input.conversationId !== null && !input.hasTranscript;
    if (sessionOpen) {
      const over = input.endedAt !== null || isStranded(input, now, maxDurationSeconds);
      return over ? { kind: "pending-transcript" } : { kind: "live-notice" };
    }
    return { kind: "room" };
  }

  if (phase === "pending") return { kind: "pending-scoring" };
  if (phase === "failed" || phase === "expired") return { kind: "failed" };
  return { kind: "report" };
}
