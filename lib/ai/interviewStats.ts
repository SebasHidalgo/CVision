import type { InterviewStats } from "@/lib/ai/schemas";
import type { TranscriptTurn } from "@/lib/elevenlabs/postCall";

/** Below either of these the feedback has to say the interview was short. */
export const SHORT_INTERVIEW_SECONDS = 120;
export const SHORT_INTERVIEW_TURNS = 4;

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

  const short =
    candidate.length < SHORT_INTERVIEW_TURNS ||
    (candidateOnFloorSeconds !== null && candidateOnFloorSeconds < SHORT_INTERVIEW_SECONDS);

  return {
    totalTurns: turns.length,
    candidateTurns: candidate.length,
    candidateWords,
    averageCandidateTurnWords: candidate.length ? round(candidateWords / candidate.length) : 0,
    candidateOnFloorSeconds,
    longestTurnGapSeconds,
    durationSeconds: durationSeconds ?? null,
    short,
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** The stats as the prompt states them, so the model comments on measured pacing. */
export function describeInterviewStats(stats: InterviewStats): string {
  const lines = [
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
    stats.short
      ? "This interview is SHORT by the thresholds above: say so in the assessment, treat the scores as low-confidence in prose, and do not pad the notable answers."
      : "This interview is long enough to score with normal confidence.",
  ];
  return lines.join("\n");
}
