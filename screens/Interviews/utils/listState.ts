import type { InterviewEntitlement } from "@/lib/interviewEntitlement";
import { waitingInterviewEntry, waitingReading } from "@/lib/interviewEntry";
import { MAX_CALL_SECONDS, MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { interviewPhase } from "@/lib/interviewStatus";
import { isStranded } from "@/lib/voice/postCall";
import type { InterviewListItem } from "@/types/interview";

/** What a row of the interviews list says of its interview. */
export type ListState =
  /** Waiting in the room, and the plan can start it (or nothing needed reading). */
  | { kind: "ready" }
  /** Waiting, and what it lacks to start. */
  | { kind: "needsPro" | "needsPack" | "noStarts" }
  /** A session was issued and nothing says it ended: a call may be running right now. */
  | { kind: "live" }
  /** The call ended and its record has not arrived. */
  | { kind: "saving" }
  /** A call dropped after the candidate spoke, or the interviewer ended it early: it continues where it stopped. */
  | { kind: "resumable"; early: boolean; secondsLeft: number }
  | { kind: "pending" }
  | { kind: "done"; score: number | null }
  | { kind: "failed" }
  | { kind: "expired" };

/**
 * The row's state, read the way the room and the feedback page read the same interview: a resumable one is the room's
 * "Continue" (with the interview time it has left), a session with no record is live until the room reported its end or
 * the call must be over (the feedback page's own rule), and a waiting one is "ready" only when the plan can start it.
 * Without the entitlement a waiting one reads "ready".
 */
export function listState(item: InterviewListItem, entitlement: InterviewEntitlement | null, now = new Date()): ListState {
  switch (interviewPhase(item.status)) {
    case "done":
      return { kind: "done", score: item.score };
    case "pending":
      return { kind: "pending" };
    case "failed":
      return { kind: "failed" };
    case "expired":
      return { kind: "expired" };
    case "ready":
      break;
  }

  if (item.secondsLeft !== null && item.resumableUntil && item.resumableUntil.getTime() > now.getTime()) {
    return { kind: "resumable", early: item.lastEnd === "interviewer" || item.lastEnd === "platform", secondsLeft: item.secondsLeft };
  }

  const sessionOpen = item.status === "IN_PROGRESS" && item.conversationId !== null && !item.hasTranscript;
  if (sessionOpen) {
    const over = item.endedAt !== null || isStranded({ status: item.status, conversationId: item.conversationId, hasTranscript: item.hasTranscript, startedAt: item.startedAt, lastSessionAt: item.lastSessionAt, callAllowedSeconds: item.callAllowedSeconds, endedAt: item.endedAt }, now, MAX_CALL_SECONDS);
    return { kind: over ? "saving" : "live" };
  }

  if (!entitlement) return { kind: "ready" };
  const reading = waitingReading(waitingInterviewEntry(item, entitlement, MAX_INTERVIEW_STARTS, now));
  return { kind: reading };
}

/** "4:44", the interview time left. */
export function timeLeft(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
