import { z } from "zod";
import { transcriptTurnSchema, type TranscriptTurn } from "./transcript";

/**
 * One interview, several calls. A call that drops after the candidate spoke
 * is kept as a segment and the interview stays resumable for a while; the
 * next call continues it. Pure: what is stored, how the calls merge into one
 * transcript, how much time is used and whether a reconnect is still on.
 */

/** How long after a drop the interview may still be resumed. */
export const RESUME_WINDOW_MS = 10 * 60_000;
/** Less than this left is not worth a call: the interview is scored instead. */
export const MIN_RESUME_SECONDS = 30;

/** The turn that stands between two calls in the merged transcript. */
export const CALL_RESUMED_ROLE = "system";
export const CALL_RESUMED_MARKER = "[call resumed]";

export const isResumeMarker = (turn: TranscriptTurn) => turn.role === CALL_RESUMED_ROLE && turn.message === CALL_RESUMED_MARKER;

export const callSegmentSchema = z.object({
  conversationId: z.string().min(1),
  turns: z.array(transcriptTurnSchema),
  durationSeconds: z.number().nonnegative(),
  startTimeSeconds: z.number().nullable(),
});
export type CallSegment = z.infer<typeof callSegmentSchema>;

const callSegmentsSchema = z.array(callSegmentSchema);

/** The stored segments, oldest first; anything else reads as none. */
export function readSegments(value: unknown): CallSegment[] {
  const parsed = callSegmentsSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

/** Adds a call in start order, once: a second delivery of the same call changes nothing. */
export function addSegment(segments: CallSegment[], segment: CallSegment): CallSegment[] {
  if (segments.some((existing) => existing.conversationId === segment.conversationId)) return segments;
  return [...segments, segment].sort((a, b) => (a.startTimeSeconds ?? Number.MAX_SAFE_INTEGER) - (b.startTimeSeconds ?? Number.MAX_SAFE_INTEGER));
}

export const segmentsSeconds = (segments: CallSegment[]) => segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);

/**
 * Every call as one transcript: the turns in order, each later call's
 * offsets continuing where the previous call ended, and a neutral marker
 * turn between two calls.
 */
export function mergeSegments(segments: CallSegment[]): TranscriptTurn[] {
  const merged: TranscriptTurn[] = [];
  let offset = 0;
  segments.forEach((segment, index) => {
    if (index > 0) merged.push({ role: CALL_RESUMED_ROLE, message: CALL_RESUMED_MARKER, time_in_call_secs: offset });
    for (const turn of segment.turns) {
      merged.push(typeof turn.time_in_call_secs === "number" ? { ...turn, time_in_call_secs: turn.time_in_call_secs + offset } : turn);
    }
    offset += segment.durationSeconds;
  });
  return merged;
}

/** The interviewer's questions in these turns, verbatim, oldest first: the continuity record of a resumed call. */
export function questionsAsked(turns: TranscriptTurn[]): string[] {
  return turns
    .filter((turn) => turn.role === "agent" && typeof turn.message === "string")
    .flatMap((turn) => (turn.message ?? "").match(/[^.!?¿¡]*\?/g) ?? [])
    .map((question) => question.replace(/\s+/g, " ").trim())
    .filter((question) => question.length > 8);
}

export type TimeFacts = {
  segments: CallSegment[];
  /** The latest call: recorded (its transcript is stored) or still outstanding. */
  latestRecorded: boolean;
  /** The candidate spoke in the latest recorded call; a silent call uses no interview time. */
  latestSpoke: boolean;
  latestDurationSeconds: number | null;
  lastSessionAt: Date | null;
  endedAt: Date | null;
};

/**
 * Seconds of the interview already used. Recorded calls count what the
 * platform measured. A call with no record yet counts from its session to
 * the room's end report, or to now: the server's own clock, never the
 * browser's, and an overestimate rather than a gift.
 */
export function usedSeconds(facts: TimeFacts, now: Date): number {
  const earlier = segmentsSeconds(facts.segments);
  if (facts.latestRecorded) return earlier + (facts.latestSpoke ? (facts.latestDurationSeconds ?? 0) : 0);
  if (!facts.lastSessionAt) return earlier;
  const until = facts.endedAt ?? now;
  return earlier + Math.max(0, Math.round((until.getTime() - facts.lastSessionAt.getTime()) / 1000));
}

export type ResumeFacts = TimeFacts & {
  status: string;
  resumableUntil: Date | null;
  startCount: number;
};

export type ResumeState = {
  /** A reconnect continues this interview rather than starting it. */
  resumable: boolean;
  usedSeconds: number;
  remainingSeconds: number;
  until: Date | null;
};

/** Whether the room should offer "Reconnect", and with how much time. */
export function resumeState(facts: ResumeFacts, plannedSeconds: number, maxStarts: number, now: Date): ResumeState {
  const used = Math.min(plannedSeconds, usedSeconds(facts, now));
  const remaining = Math.max(0, plannedSeconds - used);
  const open = facts.resumableUntil !== null && facts.resumableUntil.getTime() > now.getTime();
  // A recorded call in which nobody spoke is not an interview to resume: the next start begins it.
  const counts = facts.segments.length > 0 || !facts.latestRecorded || facts.latestSpoke;
  const resumable = facts.status === "IN_PROGRESS" && counts && open && facts.startCount < maxStarts && remaining >= MIN_RESUME_SECONDS;
  return { resumable, usedSeconds: used, remainingSeconds: remaining, until: facts.resumableUntil };
}
