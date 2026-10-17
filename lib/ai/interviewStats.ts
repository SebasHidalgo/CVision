import type { InterviewStats } from "@/lib/ai/schemas";
import type { TranscriptTurn } from "@/lib/elevenlabs/postCall";
import { MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/interviewLimits";

/**
 * "Short" is relative to the length the interview was booked for. The full
 * twelve-minute interview is short under two minutes on the floor or four
 * candidate turns, as it always was; the thresholds scale with the planned
 * length, so a five-minute trial is short under fifty seconds or three
 * turns, and a trial that filled its five minutes is complete, not short.
 */
export const SHORT_FLOOR_FRACTION = 120 / MAX_INTERVIEW_DURATION_SECONDS;
export const SHORT_TURNS_FOR_FULL_INTERVIEW = 4;
/** No planned length, however short, makes fewer answers than this enough to score. */
export const SHORT_MIN_TURNS = 3;

export type ShortThresholds = { seconds: number; turns: number };

/** Below either of these, for the given planned length, the feedback has to say the interview was short. */
export function shortThresholds(plannedSeconds: number): ShortThresholds {
  return {
    seconds: Math.round(plannedSeconds * SHORT_FLOOR_FRACTION),
    turns: Math.max(
      SHORT_MIN_TURNS,
      Math.round((SHORT_TURNS_FOR_FULL_INTERVIEW * plannedSeconds) / MAX_INTERVIEW_DURATION_SECONDS),
    ),
  };
}

/** Transcript roles: ElevenLabs writes "user" and "agent". */
export const CANDIDATE_ROLE = "user";

export const isCandidateTurn = (turn: TranscriptTurn) =>
  turn.role === CANDIDATE_ROLE && typeof turn.message === "string" && turn.message.trim() !== "";

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Facts about the transcript, from its turns alone. Deterministic, so the
 * model is handed them as data and told not to estimate pacing itself.
 *
 * The turns carry a start offset and no end, so time "on the floor" is the
 * span from a candidate turn's start to the next turn's start, which includes
 * the pause before the interviewer replies: an upper bound on speaking time,
 * named so it is not mistaken for one. The longest gap between two
 * consecutive starts bounds the longest silence from above. Both are null
 * when no offsets exist.
 */
export function computeInterviewStats(
  turns: TranscriptTurn[],
  durationSeconds: number | null,
  plannedSeconds: number = MAX_INTERVIEW_DURATION_SECONDS,
): InterviewStats {
  const candidate = turns.filter(isCandidateTurn);
  const candidateWords = candidate.reduce((sum, turn) => sum + wordCount(turn.message ?? ""), 0);

  const timed = turns.every((turn) => typeof turn.time_in_call_secs === "number");
  let candidateOnFloorSeconds: number | null = null;
  let longestTurnGapSeconds: number | null = null;

  if (timed && turns.length > 0) {
    const starts = turns.map((turn) => turn.time_in_call_secs as number);
    const end = durationSeconds ?? starts[starts.length - 1];
    candidateOnFloorSeconds = 0;
    longestTurnGapSeconds = 0;

    for (let i = 0; i < turns.length; i += 1) {
      const next = i + 1 < starts.length ? starts[i + 1] : end;
      const span = Math.max(0, next - starts[i]);
      if (isCandidateTurn(turns[i])) candidateOnFloorSeconds += span;
      if (i + 1 < starts.length) longestTurnGapSeconds = Math.max(longestTurnGapSeconds, span);
    }
    candidateOnFloorSeconds = round(candidateOnFloorSeconds);
    longestTurnGapSeconds = round(longestTurnGapSeconds);
  }

  const thresholds = shortThresholds(plannedSeconds);
  const short =
    candidate.length < thresholds.turns ||
    (candidateOnFloorSeconds !== null && candidateOnFloorSeconds < thresholds.seconds);

  return {
    totalTurns: turns.length,
    candidateTurns: candidate.length,
    candidateWords,
    averageCandidateTurnWords: candidate.length ? round(candidateWords / candidate.length) : 0,
    candidateOnFloorSeconds,
    longestTurnGapSeconds,
    durationSeconds: durationSeconds ?? null,
    plannedSeconds,
    short,
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** The stats as the prompt states them, so the model comments on measured pacing. */
export function describeInterviewStats(stats: InterviewStats): string {
  // Reports stored before the trial existed carry no planned length; they
  // were all full interviews.
  const plannedSeconds = stats.plannedSeconds ?? MAX_INTERVIEW_DURATION_SECONDS;
  const thresholds = shortThresholds(plannedSeconds);
  const lines = [
    `Planned length: ${Math.round(plannedSeconds / 60)} minutes (the format the candidate booked; an interview that fills it is complete, not short)`,
    `Candidate turns: ${stats.candidateTurns} of ${stats.totalTurns} turns in total`,
    `Candidate words: ${stats.candidateWords} (average ${stats.averageCandidateTurnWords} per turn)`,
    stats.candidateOnFloorSeconds === null
      ? "Candidate time on the floor: not measured (no timings in this transcript)"
      : `Candidate time on the floor: about ${Math.round(stats.candidateOnFloorSeconds)} seconds (from each candidate turn's start to the next turn's start, so it includes the pause before the interviewer replied)`,
    stats.longestTurnGapSeconds === null
      ? "Longest gap between turns: not measured"
      : `Longest gap between turns: about ${Math.round(stats.longestTurnGapSeconds)} seconds`,
    stats.durationSeconds === null
      ? "Call duration: not recorded"
      : `Call duration: about ${Math.round(stats.durationSeconds)} seconds`,
    `Short, for this planned length, means under ${thresholds.seconds} seconds on the floor or fewer than ${thresholds.turns} candidate turns.`,
    stats.short
      ? "This interview is SHORT by those thresholds: say so in the assessment, treat the scores as low-confidence in prose, and do not pad the notable answers."
      : "This interview is NOT short for its planned length: score it with normal confidence and do not call it short, brief or limited.",
  ];
  return lines.join("\n");
}
