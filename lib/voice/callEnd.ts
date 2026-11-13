import { z } from "zod";
import { INTERVIEW_WRAP_UP_SECONDS } from "@/lib/interviewLimits";
import type { TranscriptTurn } from "./transcript";

// Why a call ended and whether that end may stand. Pure: the server and the room share it.

/** End/Finish, end_call, the time limit, the room's hang-up, a lost connection, a platform-side end. */
export const CALL_END_REASONS = ["user", "interviewer", "limit", "room", "disconnect", "platform"] as const;
export type CallEndReason = (typeof CALL_END_REASONS)[number];

/** What the room may say about an end it saw; the platform's record settles it. */
export const ROOM_END_CLAIMS = ["user", "interviewer", "limit", "room", "disconnect"] as const;
export type RoomEndClaim = (typeof ROOM_END_CLAIMS)[number];

export const MAX_CALL_END_DETAIL_CHARS = 200;

export const callEndSchema = z.object({
  reason: z.enum(CALL_END_REASONS),
  /** The interviewer's reason for end_call, or the platform's wording; never the candidate's words. */
  detail: z.string().max(MAX_CALL_END_DETAIL_CHARS).nullish(),
  /** The room's own count of the call, to compare its clock with the platform's. */
  roomSeconds: z.number().nonnegative().nullish(),
  /** True once the platform's record settled the reason. */
  recorded: z.boolean().optional(),
});
export type CallEnd = z.infer<typeof callEndSchema>;

/** The stored end of a call; anything else reads as none. */
export function readCallEnd(value: unknown): CallEnd | null {
  const parsed = callEndSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const clipDetail = (text: string | null | undefined) => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, MAX_CALL_END_DETAIL_CHARS) : null;
};

/** How the platform recorded the end. "platform": it ended the call itself (a timeout, an error). */
export type PlatformEnd = "agent" | "limit" | "client" | "platform" | "unknown";

/** The one reason a call ended: the record wins, except where only the room can tell (End, its hang-up, a drop). */
export function settleCallEnd({
  endedBy,
  endCallReason,
  terminationReason,
  claim,
}: {
  endedBy: PlatformEnd;
  endCallReason: string | null;
  terminationReason: string | null;
  /** What the room reported before the record arrived. */
  claim: CallEnd | null;
}): CallEnd {
  const roomSeconds = claim?.roomSeconds ?? null;
  const settled = (reason: CallEndReason, detail: string | null): CallEnd => ({ reason, detail, roomSeconds, recorded: true });
  if (endedBy === "agent") return settled("interviewer", clipDetail(endCallReason));
  if (endedBy === "limit") return settled("limit", null);
  if (endedBy === "platform") return settled("platform", clipDetail(terminationReason));
  // The client left: End, the room's hang-up and a drop look the same to the platform.
  if (claim?.reason === "user" || claim?.reason === "room") return settled(claim.reason, null);
  return settled("disconnect", clipDetail(terminationReason));
}

type Spoken = { role: string; text: string };

const spokenTurns = (turns: TranscriptTurn[]): Spoken[] =>
  turns.flatMap((turn) => ((turn.role === "agent" || turn.role === "user") && typeof turn.message === "string" && turn.message.trim() !== "" ? [{ role: turn.role, text: turn.message }] : []));

const FEEDBACK_WORD = /\b(feedback|retroalimentaci[oó]n|comentarios|devoluci[oó]n)\b/i;
const SCREEN_WORD = /\b(pantalla|screen)\b/i;
const isGoodbye = (text: string) => FEEDBACK_WORD.test(text) && SCREEN_WORD.test(text);

/** The interviewer's last line was the goodbye: the one that names the feedback on the screen. */
export function saidGoodbye(turns: TranscriptTurn[]): boolean {
  const last = spokenTurns(turns).findLast((turn) => turn.role === "agent");
  return Boolean(last && isGoodbye(last.text));
}

/** The interviewer spoke last, and it was not the goodbye: whatever it asked has no answer. */
export function endsUnanswered(turns: TranscriptTurn[]): boolean {
  const last = spokenTurns(turns).at(-1);
  return Boolean(last && last.role === "agent" && !isGoodbye(last.text));
}

const CONFIRM_END = /\b(terminar|terminemos|finalizar|acabar|dejarlo aqu[ií]|end (the|this|our) (interview|call|session)|stop (here|now)|finish (here|now|up))\b/i;
const DECLINED = /^\W*(no\b|nope\b|not yet|todav[ií]a no|a[uú]n no|mejor (no|sigamos)|sigamos|continuemos|let'?s (continue|keep going|go on)|keep going|continue\b)/i;

/** The candidate was asked whether to end the interview and did not say no. */
export function candidateConfirmedStop(turns: TranscriptTurn[]): boolean {
  const said = spokenTurns(turns);
  const reply = said.findLastIndex((turn) => turn.role === "user");
  if (reply < 1) return false;
  const asked = said[reply - 1];
  if (asked.role !== "agent" || !/[?？]/.test(asked.text) || !CONFIRM_END.test(asked.text)) return false;
  return !DECLINED.test(said[reply].text);
}

/** With this little left an end stands whatever was said: no call is worth resuming. */
export const EARLY_END_MIN_LEFT_SECONDS = 30;

/** An end by the interviewer or the platform that came too soon: resumable, its connection given back. */
export function isEarlyEnd({
  endedBy,
  secondsLeft,
  finishRequested,
  turns,
}: {
  endedBy: PlatformEnd;
  /** Of the whole interview, after this call. */
  secondsLeft: number;
  /** End, or "Finish and get feedback": the candidate's own decision. */
  finishRequested: boolean;
  turns: TranscriptTurn[];
}): boolean {
  if (endedBy !== "agent" && endedBy !== "platform") return false;
  if (finishRequested || !Number.isFinite(secondsLeft) || secondsLeft <= EARLY_END_MIN_LEFT_SECONDS) return false;
  // A question left hanging, or no goodbye at all.
  if (endsUnanswered(turns) || !saidGoodbye(turns)) return true;
  // A clean goodbye with minutes left counts only when the candidate asked for it.
  return secondsLeft > INTERVIEW_WRAP_UP_SECONDS && !candidateConfirmedStop(turns);
}
