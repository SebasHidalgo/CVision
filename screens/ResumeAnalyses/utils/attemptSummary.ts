import type { InterviewEntitlement } from "@/lib/interviewEntitlement";
import { waitingInterviewEntry, waitingReading, type WaitingReading } from "@/lib/interviewEntry";
import { MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { interviewPhase } from "@/lib/interviewStatus";
import type { InterviewAttempt } from "@/types/resume";

/** What a row says of its latest rehearsal: a key under `analyses:row.reading`. */
export type AttemptReading = WaitingReading | "pending" | "failed" | "expired" | "completed" | "scored";

export type AttemptSummary = {
  number: number;
  reading: AttemptReading;
  score: number | null;
  /** Rehearsals before the latest one. */
  earlier: number;
};

/**
 * The latest rehearsal of an analysis (attempts come newest first), read as the analysis page reads it: a waiting
 * one is "ready" only when the plan can start it (`waitingInterviewEntry`). Without the entitlement (nothing on the
 * page is waiting, so it wasn't read) a waiting one reads "ready".
 */
export function attemptSummary(attempts: InterviewAttempt[], entitlement: InterviewEntitlement | null, now = new Date()): AttemptSummary | null {
  const latest = attempts[0];
  if (!latest) return null;

  const base = { number: latest.attemptNumber, score: null, earlier: attempts.length - 1 };
  switch (interviewPhase(latest.status)) {
    case "ready":
      return { ...base, reading: entitlement ? waitingReading(waitingInterviewEntry(latest, entitlement, MAX_INTERVIEW_STARTS, now)) : "ready" };
    case "done":
      return latest.totalScore === null ? { ...base, reading: "completed" } : { ...base, reading: "scored", score: latest.totalScore };
    case "pending":
      return { ...base, reading: "pending" };
    case "failed":
      return { ...base, reading: "failed" };
    case "expired":
      return { ...base, reading: "expired" };
  }
}

/** Whether any latest rehearsal waits to start: only then does the screen read the entitlement. */
export function anyWaiting(attemptLists: InterviewAttempt[][]): boolean {
  return attemptLists.some((attempts) => attempts[0] !== undefined && interviewPhase(attempts[0].status) === "ready");
}
