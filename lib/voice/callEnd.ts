import { z } from "zod";
import type { TranscriptTurn } from "./transcript";

// Why a call ended and whether that end may stand. Pure: the server and the room share it.

/** End/Finish, the interviewer's tool, the time limit, the room's hang-up, a lost connection, a platform-side end. */
export const CALL_END_REASONS = ["user", "interviewer", "limit", "room", "disconnect", "platform"] as const;
export type CallEndReason = (typeof CALL_END_REASONS)[number];

/** What the room may say about an end it saw; the platform's record settles it. */
export const ROOM_END_CLAIMS = ["user", "interviewer", "limit", "room", "disconnect"] as const;
export type RoomEndClaim = (typeof ROOM_END_CLAIMS)[number];

/** The client tool the interviewer asks the room to end the call with; the room may refuse. */
export const END_INTERVIEW_TOOL = "end_interview";
export const END_TOOL_REASONS = ["time_up", "candidate_confirmed"] as const;
export type EndToolReason = (typeof END_TOOL_REASONS)[number];
/** How the room's answer starts: the record shows whether the call was to end. */
export const END_TOOL_ALLOWED = "ALLOWED";
export const END_TOOL_REFUSED = "REFUSED";

/** What an interviewer end is stored as: the time was up, or the candidate confirmed. */
export const END_DETAILS = ["time_up", "confirmed"] as const;
export type EndDetail = (typeof END_DETAILS)[number];
const endDetailOf = (reason: EndToolReason): EndDetail => (reason === "candidate_confirmed" ? "confirmed" : "time_up");

/** The last end_interview call of a record: its reason, and whether the room refused it (the room answers every refusal; an allowed call ends the session). */
export type EndToolCall = { reason: EndToolReason; refused: boolean };

export const MAX_CALL_END_DETAIL_CHARS = 200;

export const callEndSchema = z.object({
  reason: z.enum(CALL_END_REASONS),
  /** time_up | confirmed for the interviewer's tool; the platform's wording otherwise. Never the candidate's words. */
  detail: z.string().max(MAX_CALL_END_DETAIL_CHARS).nullish(),
  /** The room's own count of the call, to compare its clock with the platform's. */
  roomSeconds: z.number().nonnegative().nullish(),
  /** True once the platform's record settled the reason. */
  recorded: z.boolean().optional(),
  /** Turns of this call the backup model answered. */
  backupTurns: z.number().int().nonnegative().optional(),
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

const isEndDetail = (value: unknown): value is EndDetail => value === "time_up" || value === "confirmed";

/** How the platform recorded the end. "agent": the old end_call tool. "platform": it ended the call itself. */
export type PlatformEnd = "agent" | "limit" | "client" | "platform" | "unknown";

/** The one reason a call ended: the record wins, except where only the room can tell (End, its hang-up, a drop). */
export function settleCallEnd({
  endedBy,
  endTool = null,
  endCallReason,
  terminationReason,
  claim,
  backupTurns = 0,
}: {
  endedBy: PlatformEnd;
  /** The record's last end_interview call, if any. */
  endTool?: EndToolCall | null;
  /** The reason the interviewer gave the old end_call tool. */
  endCallReason: string | null;
  terminationReason: string | null;
  /** What the room reported before the record arrived. */
  claim: CallEnd | null;
  backupTurns?: number;
}): CallEnd {
  const roomSeconds = claim?.roomSeconds ?? null;
  const settled = (reason: CallEndReason, detail: string | null): CallEnd => ({ reason, detail, roomSeconds, recorded: true, ...(backupTurns > 0 ? { backupTurns } : {}) });
  if (endedBy === "agent") return settled("interviewer", clipDetail(endCallReason));
  if (endedBy === "limit") return settled("limit", null);
  if (endedBy === "platform") return settled("platform", clipDetail(terminationReason));
  // The client left. The room hung up on the interviewer's tool when the record shows a call it did not refuse.
  if (endTool && !endTool.refused) return settled("interviewer", endDetailOf(endTool.reason));
  if (claim?.reason === "user" || claim?.reason === "room") return settled(claim.reason, null);
  // The room says so and the record lost the tool turn.
  if (claim?.reason === "interviewer" && isEndDetail(claim.detail)) return settled("interviewer", claim.detail);
  return settled("disconnect", clipDetail(terminationReason));
}

/** A room report that lands after the record: it still says what only the room knows. Null when nothing changes. */
export function withLateClaim(stored: CallEnd | null, claim: { reason: RoomEndClaim; detail?: string | null; roomSeconds: number | null }): CallEnd | null {
  if (!stored?.recorded) return null;
  const roomSeconds = stored.roomSeconds ?? claim.roomSeconds;
  if (stored.reason === "disconnect" && (claim.reason === "user" || claim.reason === "room")) return { ...stored, reason: claim.reason, detail: null, roomSeconds };
  if (stored.reason === "disconnect" && claim.reason === "interviewer" && isEndDetail(claim.detail)) return { ...stored, reason: "interviewer", detail: claim.detail, roomSeconds };
  return roomSeconds !== (stored.roomSeconds ?? null) ? { ...stored, roomSeconds } : null;
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
  // The last time the interviewer asked, and the candidate's first words after it.
  const asked = said.findLastIndex((turn) => turn.role === "agent" && /[?？]/.test(turn.text) && CONFIRM_END.test(turn.text));
  if (asked < 0) return false;
  const reply = said.slice(asked + 1).find((turn) => turn.role === "user");
  return Boolean(reply) && !DECLINED.test(reply!.text);
}

const ASKS = /[?？]/;

/** Since the candidate last spoke, the interviewer asked something that is not the goodbye: it still has no answer. */
export function questionPending(turns: TranscriptTurn[]): boolean {
  const said = spokenTurns(turns);
  const lastAnswer = said.findLastIndex((turn) => turn.role === "user");
  return said.slice(lastAnswer + 1).some((turn) => turn.role === "agent" && ASKS.test(turn.text) && !isGoodbye(turn.text));
}

const timeLeftWords = (seconds: number) => {
  // Rounded up: a fraction of a second left is not "0 s".
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  return minutes > 0 ? `${minutes} min ${whole % 60} s` : `${whole} s`;
};

/**
 * The room's answer to the interviewer's end_interview: what the tool returns and whether the room now hangs up.
 * Allowed: whether the goodbye was already said, and whether a question before it still waits for the candidate's answer.
 * Refused: silent when the interviewer's last words asked something (the candidate is about to answer), spoken otherwise.
 */
export type EndToolDecision = { allow: true; detail: EndDetail; result: string; goodbyeSaid: boolean; awaitAnswer: boolean } | { allow: false; result: string; silent: boolean };

/** The answer to an allowed call whose goodbye was already spoken; it goes out as the room hangs up. */
export const END_ALLOWED_QUIET = `${END_TOOL_ALLOWED}: the room is ending the call now. Say nothing more.`;

const allowed = (detail: EndDetail, turns: TranscriptTurn[]): EndToolDecision => {
  // The goodbye normally comes in the same turn as the tool; a call without it gets the chance to say it.
  const goodbyeSaid = saidGoodbye(turns) && spokenTurns(turns).at(-1)?.role === "agent";
  const result = goodbyeSaid
    ? END_ALLOWED_QUIET
    : `${END_TOOL_ALLOWED}: the room hangs up when you finish speaking. Say the goodbye now, in the call's language, in two short sentences: thank the candidate for practicing, and say their feedback will appear on their screen in a moment. Ask nothing and do not call end_interview again.`;
  // A confirmed stop was answered by the confirmation itself; a time-up goodbye may come over an open question.
  return { allow: true, detail, result, goodbyeSaid, awaitAnswer: detail === "time_up" && questionPending(turns) };
};

/** After the candidate answered the question the goodbye came over: one more short goodbye, then the room hangs up. */
export const END_ALLOWED_AFTER_ANSWER = `${END_TOOL_ALLOWED}: the candidate has answered and the room hangs up when you finish speaking. Say one short sentence that thanks them for the answer and says their feedback will appear on their screen in a moment. Ask nothing and do not call end_interview again.`;

/** A refusal while the interviewer's question waits for its answer: no words, or the candidate hears the question twice. */
const refusedSilently = (why: string) =>
  `${END_TOOL_REFUSED}: the call continues. ${why} Your question is still waiting for the candidate's answer, so say nothing now: reply with no words at all, and let them answer. Do not repeat or rephrase the question. Do not call end_interview until a [time] line says the time is up.`;

/** A refusal after a turn that asked nothing (an early goodbye): the interview picks up with a new question. */
const refusedAloud = (why: string) =>
  `${END_TOOL_REFUSED}: the call continues. ${why} Do not say goodbye again and do not call end_interview until a [time] line says the time is up. Say one short bridging phrase in the call's language (in English "Let's keep going a little longer.", in Spanish "Sigamos un poco más.") and ask your next interview question now, one you have not asked before.`;

/** The end a room claim describes, when the record lost the tool turn. */
export function endToolFromClaim(claim: CallEnd | null | undefined): EndToolCall | null {
  if (claim?.reason !== "interviewer" || !isEndDetail(claim.detail)) return null;
  return { reason: claim.detail === "confirmed" ? "candidate_confirmed" : "time_up", refused: false };
}

/** The veto. Time-up only once the paid time is over; a confirmed stop only when the candidate answered the question. */
export function decideEndTool({
  reason,
  paidSecondsLeft,
  turns,
}: {
  /** What the interviewer passed; anything unknown is read as time_up. */
  reason: unknown;
  /** Of this call's paid length, by the room's clock. */
  paidSecondsLeft: number;
  /** The live lines, for the confirmation exchange. */
  turns: TranscriptTurn[];
}): EndToolDecision {
  const silent = questionPending(turns);
  if (reason === "candidate_confirmed") {
    if (candidateConfirmedStop(turns)) return allowed("confirmed", turns);
    const why = `The candidate has not answered yes to "Do you want to end the interview now?".`;
    return {
      allow: false,
      silent,
      result: silent
        ? refusedSilently(why)
        : `${END_TOOL_REFUSED}: the call continues. ${why} If they asked to stop, ask that question on its own, in the call's language, and wait for their answer. Otherwise say one short bridging phrase and go on with your next interview question. Do not say goodbye again.`,
    };
  }
  if (paidSecondsLeft <= 0) return allowed("time_up", turns);
  const why = `The interview time is not up: ${timeLeftWords(paidSecondsLeft)} remain.`;
  return { allow: false, silent, result: silent ? refusedSilently(why) : refusedAloud(why) };
}

/** With this little left an end stands whatever was said: no call is worth resuming. */
export const EARLY_END_MIN_LEFT_SECONDS = 30;
/** Records of the old end_call tool: a clean goodbye with more than this left was early unless asked for. */
const LEGACY_WRAP_UP_SECONDS = 75;

/** An end before the paid time was up that was neither the candidate's End nor a confirmed stop: resumable, its connection given back. */
export function isEarlyEnd({
  endedBy,
  endTool = null,
  secondsLeft,
  finishRequested,
  turns,
}: {
  endedBy: PlatformEnd;
  endTool?: EndToolCall | null;
  /** Of the whole interview's paid time, after this call. */
  secondsLeft: number;
  /** End, or "Finish and get feedback": the candidate's own decision. */
  finishRequested: boolean;
  turns: TranscriptTurn[];
}): boolean {
  if (finishRequested || !Number.isFinite(secondsLeft) || secondsLeft <= EARLY_END_MIN_LEFT_SECONDS) return false;
  // The platform ended it by itself (a silence timeout, an error) with paid time left.
  if (endedBy === "platform") return true;
  // Older records, when the platform's end_call could hang up: matched by the goodbye's words.
  if (endedBy === "agent") {
    if (endsUnanswered(turns) || !saidGoodbye(turns)) return true;
    return secondsLeft > LEGACY_WRAP_UP_SECONDS && !candidateConfirmedStop(turns);
  }
  // The room hung up on the tool with paid time left: only a confirmed stop may do that.
  if (endTool && !endTool.refused) return endTool.reason !== "candidate_confirmed";
  return false;
}
