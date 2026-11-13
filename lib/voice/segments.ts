import { z } from "zod";
import { callEndSchema } from "./callEnd";
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
  /** Why the call ended; absent on calls stored before M10-E. */
  end: callEndSchema.optional(),
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

/** One thing the interviewer asked and the gist of what the candidate said to it. */
export type ContinuityExchange = { question: string; answer: string };

/** What a resumed call is told about the calls before it. */
export type ContinuityRecord = {
  /** Oldest first. */
  exchanges: ContinuityExchange[];
  /** The interviewer's last question, when the call dropped before any answer to it. */
  pending: string | null;
};

export const MAX_CONTINUITY_QUESTION_CHARS = 320;
export const MAX_CONTINUITY_ANSWER_CHARS = 240;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Hesitation sounds a transcript is full of; they carry nothing. */
const FILLER = /(?<![\p{L}\p{N}])(?:e+h+|a+h+|m{2,}|u+h+|u+m+|h+m+)(?![\p{L}\p{N}])[,.…]*\s*/giu;

/** The start of an answer on one line, without the hesitations. */
function gist(text: string): string {
  const said = oneLine(text.replace(FILLER, " ")).replace(/^[,.;:\s-]+/, "");
  return said.length > MAX_CONTINUITY_ANSWER_CHARS ? `${said.slice(0, MAX_CONTINUITY_ANSWER_CHARS - 1)}…` : said;
}

/** The end of a turn, from a sentence start: what a turn closes with is its question. */
function closing(text: string): string {
  const said = oneLine(text);
  if (said.length <= MAX_CONTINUITY_QUESTION_CHARS) return said;
  let kept = "";
  for (const sentence of said.split(/(?<=[.!?…])\s+/).reverse()) {
    const next = kept ? `${sentence} ${kept}` : sentence;
    if (next.length > MAX_CONTINUITY_QUESTION_CHARS) break;
    kept = next;
  }
  return kept || `…${said.slice(said.length - MAX_CONTINUITY_QUESTION_CHARS + 1)}`;
}

type Said = { role: "agent" | "user"; text: string };

/** Who spoke, in order, with one speaker's consecutive turns joined. Silent turns (a tool call) are left out. */
function speakerBlocks(turns: TranscriptTurn[]): Said[] {
  const blocks: Said[] = [];
  for (const turn of turns) {
    const text = oneLine(turn.message ?? "");
    if (!text || (turn.role !== "agent" && turn.role !== "user")) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.role === turn.role) last.text = `${last.text} ${text}`;
    else blocks.push({ role: turn.role, text });
  }
  return blocks;
}

/** The continuity record, cut from the turns in code: exchanges with their gist, and the question a drop left pending. */
export function continuityRecord(turns: TranscriptTurn[]): ContinuityRecord {
  const calls: TranscriptTurn[][] = [[]];
  for (const turn of turns) {
    if (isResumeMarker(turn)) calls.push([]);
    else calls[calls.length - 1].push(turn);
  }

  const exchanges: ContinuityExchange[] = [];
  let pending: string | null = null;
  calls.forEach((call, index) => {
    let spoken = call.filter((turn) => oneLine(turn.message ?? "") !== "");
    if (index > 0 && spoken[0]?.role === "agent") {
      const afterReply = spoken.findIndex((turn, at) => at > 0 && turn.role !== "user");
      spoken = afterReply < 0 ? [] : spoken.slice(afterReply);
    }
    const blocks = speakerBlocks(spoken);
    blocks.forEach((block, at) => {
      if (block.role !== "agent") return;
      const reply = blocks[at + 1]?.role === "user" ? gist(blocks[at + 1].text) : "";
      if (reply) {
        exchanges.push({ question: closing(block.text), answer: reply });
        return;
      }
      // Pending only where the interview stopped: the last thing said in the latest call, and a question.
      const lastWord = index === calls.length - 1 && !blocks.slice(at + 1).some((later) => later.role === "agent");
      if (lastWord && block.text.includes("?")) pending = closing(block.text);
    });
  });
  return { exchanges, pending };
}

export type TimeFacts = {
  segments: CallSegment[];
  /** The latest call: recorded (its transcript is stored) or still outstanding. */
  latestRecorded: boolean;
  /** The latest recorded call counts: the candidate spoke in it, or already had in an earlier call. A silent first call uses no interview time. */
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
