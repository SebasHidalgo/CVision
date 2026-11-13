import { describe, expect, it } from "vitest";
import {
  candidateConfirmedStop,
  decideEndTool,
  END_TOOL_ALLOWED,
  END_TOOL_REFUSED,
  endsUnanswered,
  endToolFromClaim,
  isEarlyEnd,
  readCallEnd,
  saidGoodbye,
  settleCallEnd,
  withLateClaim,
  type EndToolCall,
  type PlatformEnd,
} from "./callEnd";

type Turn = { role: string; message: string | null };
const agent = (message: string | null): Turn => ({ role: "agent", message });
const user = (message: string): Turn => ({ role: "user", message });

const GOODBYE_ES = "Gracias por practicar, Lucía. Tu feedback aparecerá en tu pantalla en un momento.";
const GOODBYE_EN = "Thanks for practicing, Dana. Your feedback will appear on your screen in a moment.";

// An invented call: two exchanges, then whatever the case adds.
const base: Turn[] = [agent("Hola Lucía. Cuéntame brevemente sobre tu trayectoria."), user("Llevo tres años en soporte y uno en QA."), agent("¿Qué herramienta usabas para reportar errores?"), user("Jira, casi siempre.")];

const early = (turns: Turn[], secondsLeft: number, endedBy: PlatformEnd = "agent", finishRequested = false) => isEarlyEnd({ endedBy, secondsLeft, finishRequested, turns });

describe("what the interviewer's last words were", () => {
  it("reads the goodbye as the line that names the feedback on the screen, in both languages", () => {
    expect(saidGoodbye([...base, agent(GOODBYE_ES)])).toBe(true);
    expect(saidGoodbye([...base, agent(GOODBYE_EN)])).toBe(true);
    // The candidate answering the goodbye does not undo it.
    expect(saidGoodbye([...base, agent(GOODBYE_ES), user("Gracias, hasta luego.")])).toBe(true);
    expect(saidGoodbye(base)).toBe(false);
    expect(saidGoodbye([...base, agent("Gracias por tu tiempo.")])).toBe(false);
  });

  it("reads an interviewer line with nothing after it as unanswered, question mark or not", () => {
    expect(endsUnanswered([...base, agent("¿Cómo priorizabas los errores?")])).toBe(true);
    expect(endsUnanswered([...base, agent("Me gustaría que me cuentes de un proyecto, detallando tu rol.")])).toBe(true);
    expect(endsUnanswered(base)).toBe(false);
    expect(endsUnanswered([...base, agent(GOODBYE_ES)])).toBe(false);
    // Tool turns carry no words and do not count as the last line.
    expect(endsUnanswered([...base, agent(null)])).toBe(false);
  });

  it("reads a yes to the confirmation question, and only that", () => {
    const asked = [...base, agent("¿Cómo priorizabas los errores?"), user("Prefiero terminar aquí."), agent("Claro. ¿Quieres terminar la entrevista ahora?")];
    expect(candidateConfirmedStop([...asked, user("Sí, terminemos."), agent(GOODBYE_ES)])).toBe(true);
    expect(candidateConfirmedStop([...asked, user("No, mejor sigamos."), agent(GOODBYE_ES)])).toBe(false);
    expect(candidateConfirmedStop([...base, agent(GOODBYE_ES)])).toBe(false);
    // A word of thanks after the goodbye is not the answer to the question.
    expect(candidateConfirmedStop([...asked, user("Sí, terminemos."), agent(GOODBYE_ES), user("Gracias, hasta luego.")])).toBe(true);
    expect(candidateConfirmedStop([...asked, user("No, mejor sigamos."), agent(GOODBYE_ES), user("Bueno, gracias.")])).toBe(false);
    // Asked, and the call ended before any answer.
    expect(candidateConfirmedStop(asked)).toBe(false);
    const english = [agent("Do you want to end the interview now?"), user("Yes, please.")];
    expect(candidateConfirmedStop(english)).toBe(true);
    expect(candidateConfirmedStop([agent("Do you want to end the interview now?"), user("Not yet, let's continue.")])).toBe(false);
  });
});

// Records from when the platform's end_call could hang up: judged by the goodbye's words.
describe("isEarlyEnd: records of the old end_call tool", () => {
  it("catches the owner's first trial: a last request with no answer, end_call, 65 s left, the wrap-up line already sent", () => {
    const turns = [...base, agent("Tranquila. Para ir cerrando, cuéntame de alguna mejora que hayas propuesto, explicando qué cambió.")];
    expect(early(turns, 65)).toBe(true);
  });

  it("lets a goodbye after the candidate's answer stand once the wrap-up time is reached", () => {
    expect(early([...base, agent(GOODBYE_ES)], 50)).toBe(false);
    expect(early([...base, agent(GOODBYE_EN)], 75)).toBe(false);
  });

  it("treats an end without a goodbye as early, whoever spoke last", () => {
    // The candidate answered and the interviewer hung up without a word.
    expect(early(base, 60)).toBe(true);
    // The goodbye went into the tool only: nothing was heard.
    expect(early([...base, agent(null)], 60)).toBe(true);
  });

  it("treats a goodbye with minutes left as early unless the candidate asked for it", () => {
    expect(early([...base, agent(GOODBYE_ES)], 180)).toBe(true);
    const asked = [...base, agent("¿Cómo priorizabas los errores?"), user("Quiero terminar."), agent("¿Quieres terminar la entrevista ahora?")];
    expect(early([...asked, user("Sí."), agent(GOODBYE_ES)], 180)).toBe(false);
    expect(early([...asked, user("No, sigamos."), agent(GOODBYE_ES)], 180)).toBe(true);
  });

  it("lets any end stand with 30 s or less left, and the candidate's own End always", () => {
    const hanging = [...base, agent("¿Cómo priorizabas los errores?")];
    expect(early(hanging, 31)).toBe(true);
    expect(early(hanging, 30)).toBe(false);
    expect(early(hanging, 200, "agent", true)).toBe(false);
  });

  it("covers a platform-side end, and never a disconnect, the limit or an unnamed end", () => {
    const hanging = [...base, agent("¿Cómo priorizabas los errores?")];
    expect(early(hanging, 100, "platform")).toBe(true);
    expect(early(hanging, 100, "client")).toBe(false);
    expect(early(hanging, 100, "limit")).toBe(false);
    expect(early(hanging, 100, "unknown")).toBe(false);
    // No planned length known: nothing to call early.
    expect(early(hanging, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("settleCallEnd", () => {
  const settle = (endedBy: PlatformEnd, claim: Parameters<typeof settleCallEnd>[0]["claim"] = null, extra: { endCallReason?: string | null; terminationReason?: string | null } = {}) =>
    settleCallEnd({ endedBy, endCallReason: extra.endCallReason ?? null, terminationReason: extra.terminationReason ?? null, claim });

  it("takes the platform's word for the interviewer, the limit and its own ends", () => {
    expect(settle("agent", { reason: "disconnect", roomSeconds: 233.4 }, { endCallReason: "  The interview is\ncomplete. " })).toEqual({ reason: "interviewer", detail: "The interview is complete.", roomSeconds: 233.4, recorded: true });
    expect(settle("limit")).toEqual({ reason: "limit", detail: null, roomSeconds: null, recorded: true });
    expect(settle("platform", null, { terminationReason: "Call ended after a long silence" })).toMatchObject({ reason: "platform", detail: "Call ended after a long silence" });
    expect(settle("agent", null, { endCallReason: "x".repeat(500) }).detail).toHaveLength(200);
  });

  it("takes the room's word where the platform only sees the client leave", () => {
    const left = { terminationReason: "Client disconnected: 1005" };
    expect(settle("client", { reason: "user", roomSeconds: 120 }, left)).toMatchObject({ reason: "user", detail: null, roomSeconds: 120 });
    expect(settle("client", { reason: "room", roomSeconds: 303 }, left)).toMatchObject({ reason: "room" });
    expect(settle("client", { reason: "disconnect" }, left)).toMatchObject({ reason: "disconnect", detail: "Client disconnected: 1005" });
    // No report from the room (the tab died): a disconnect.
    expect(settle("client", null, left)).toMatchObject({ reason: "disconnect" });
    // The room thought the interviewer ended it; the record says the client left.
    expect(settle("client", { reason: "interviewer" }, left)).toMatchObject({ reason: "disconnect" });
    expect(settle("unknown")).toMatchObject({ reason: "disconnect", detail: null });
  });

  it("lets a room report that lands after the record say what only the room knows", () => {
    const dropped = { reason: "disconnect" as const, detail: "Client disconnected: 1005", roomSeconds: null, recorded: true };
    // The webhook won the race: the candidate's End was stored as a disconnect.
    expect(withLateClaim(dropped, { reason: "user", roomSeconds: 3.1 })).toEqual({ reason: "user", detail: null, roomSeconds: 3.1, recorded: true });
    expect(withLateClaim(dropped, { reason: "room", roomSeconds: 303 })).toMatchObject({ reason: "room" });
    // A disconnect stays one, with the room's clock added.
    expect(withLateClaim(dropped, { reason: "disconnect", roomSeconds: 40 })).toEqual({ ...dropped, roomSeconds: 40 });
    // The platform's own word is never replaced; only the missing clock is filled.
    const hungUp = { reason: "interviewer" as const, detail: "Time is up.", roomSeconds: null, recorded: true };
    expect(withLateClaim(hungUp, { reason: "user", roomSeconds: 235 })).toEqual({ ...hungUp, roomSeconds: 235 });
    expect(withLateClaim({ ...hungUp, roomSeconds: 234 }, { reason: "interviewer", roomSeconds: 235 })).toBeNull();
    // Nothing recorded yet: the ordinary report writes the claim.
    expect(withLateClaim(null, { reason: "user", roomSeconds: 1 })).toBeNull();
    expect(withLateClaim({ reason: "user", recorded: false }, { reason: "user", roomSeconds: 1 })).toBeNull();
  });

  it("reads back only what it wrote", () => {
    expect(readCallEnd({ reason: "interviewer", detail: "done", roomSeconds: 12, recorded: true })).toMatchObject({ reason: "interviewer" });
    expect(readCallEnd({ reason: "nonsense" })).toBeNull();
    expect(readCallEnd(null)).toBeNull();
  });
});

describe("decideEndTool: the room's answer to end_interview", () => {
  const asked = [...base, agent("¿Cómo priorizabas los errores?"), user("Prefiero terminar aquí."), agent("Claro. ¿Quieres terminar la entrevista ahora?")];

  it("refuses time_up while paid time is left, and says how much and what to do instead", () => {
    const decision = decideEndTool({ reason: "time_up", paidSecondsLeft: 66, turns: base });
    expect(decision.allow).toBe(false);
    expect(decision.result.startsWith(`${END_TOOL_REFUSED}: the call continues.`)).toBe(true);
    expect(decision.result).toContain("The interview time is not up: 1 min 6 s remain.");
    expect(decision.result).toContain("Do not say goodbye again and do not call end_interview until a [time] line says the time is up.");
    expect(decision.result).toContain('Say one short bridging phrase (in Spanish, "Sigamos un poco más.") and ask your next interview question now.');
    // Under a minute the time left is said in seconds; a fraction of a second left is still time left.
    expect(decideEndTool({ reason: "time_up", paidSecondsLeft: 45.7, turns: base }).result).toContain("45 s remain");
    expect(decideEndTool({ reason: "time_up", paidSecondsLeft: 0.4, turns: base }).allow).toBe(false);
  });

  it("today's shape: an answer ending at 3:54 of a five-minute trial does not lead to a goodbye", () => {
    // The candidate finished an answer at 234 s; the interviewer asks to end with 66 s of paid time left.
    const turns = [...base, agent("¿Cómo priorizabas los errores?"), user("Primero los que bloqueaban a un cliente, después por frecuencia.")];
    const decision = decideEndTool({ reason: "time_up", paidSecondsLeft: 300 - 234, turns });
    expect(decision).toMatchObject({ allow: false });
    expect(decision.result).not.toContain(END_TOOL_ALLOWED);
    expect(saidGoodbye([{ role: "agent", message: decision.result }])).toBe(false);
  });

  it("allows time_up once the paid time is over, and tells the interviewer to say the goodbye now", () => {
    for (const left of [0, -1, -42]) {
      const decision = decideEndTool({ reason: "time_up", paidSecondsLeft: left, turns: base });
      expect(decision).toMatchObject({ allow: true, detail: "time_up" });
      expect(decision.result.startsWith(`${END_TOOL_ALLOWED}:`)).toBe(true);
      expect(decision.result).toContain("the room hangs up when you finish speaking");
      expect(decision.result).toContain("Ask nothing and do not call end_interview again.");
    }
  });

  it("allows candidate_confirmed only after the confirmation question got an answer that is not a no, whatever the clock says", () => {
    expect(decideEndTool({ reason: "candidate_confirmed", paidSecondsLeft: 200, turns: [...asked, user("Sí, terminemos.")] })).toMatchObject({ allow: true, detail: "confirmed" });
    // The request alone, a no, or no question at all: refused, with the question to ask.
    for (const turns of [base, asked, [...asked, user("No, mejor sigamos.")], [...base, user("Creo que ya está.")]]) {
      const decision = decideEndTool({ reason: "candidate_confirmed", paidSecondsLeft: 200, turns });
      expect(decision.allow).toBe(false);
      expect(decision.result.startsWith(END_TOOL_REFUSED)).toBe(true);
      expect(decision.result).toContain('"Do you want to end the interview now?"');
      expect(decision.result).toContain("Do not say goodbye again.");
    }
    // The goodbye that came with the call is known to the room: it has nothing to add before hanging up.
    const withGoodbye = decideEndTool({ reason: "candidate_confirmed", paidSecondsLeft: 200, turns: [...asked, user("Sí, terminemos."), agent("Gracias por practicar. Tu feedback aparecerá en tu pantalla en un momento.")] });
    expect(withGoodbye).toMatchObject({ allow: true, detail: "confirmed", goodbyeSaid: true });
    expect(withGoodbye.result).toBe("ALLOWED: the room is ending the call now. Say nothing more.");
    // Called without it: the answer asks for the goodbye.
    const without = decideEndTool({ reason: "candidate_confirmed", paidSecondsLeft: 200, turns: [...asked, user("Sí, terminemos.")] });
    expect(without).toMatchObject({ allow: true, goodbyeSaid: false });
    expect(without.result).toContain("Say the goodbye now");
    // Claiming a confirmation after the time is up changes nothing about the rule: it still needs the exchange.
    expect(decideEndTool({ reason: "candidate_confirmed", paidSecondsLeft: -5, turns: base }).allow).toBe(false);
  });

  it("reads an unknown or missing reason as time_up", () => {
    for (const reason of [undefined, null, "", "done", 7, { reason: "time_up" }]) {
      expect(decideEndTool({ reason, paidSecondsLeft: 120, turns: [...asked, user("Sí.")] }).allow).toBe(false);
      expect(decideEndTool({ reason, paidSecondsLeft: 0, turns: base })).toMatchObject({ allow: true, detail: "time_up" });
    }
  });
});

describe("isEarlyEnd: a call the room hung up on the interviewer's tool", () => {
  const tool = (reason: EndToolCall["reason"], refused = false): EndToolCall => ({ reason, refused });
  const byTool = (endTool: EndToolCall | null, secondsLeft: number, finishRequested = false) => isEarlyEnd({ endedBy: "client", endTool, secondsLeft, finishRequested, turns: [...base, agent(GOODBYE_ES)] });

  it("is early when time_up was allowed with paid time left, goodbye or not: only the clock decides", () => {
    expect(byTool(tool("time_up"), 66)).toBe(true);
    expect(byTool(tool("time_up"), 31)).toBe(true);
    expect(byTool(tool("time_up"), 30)).toBe(false);
    expect(byTool(tool("time_up"), 0)).toBe(false);
    expect(byTool(tool("time_up"), -40)).toBe(false);
  });

  it("lets a confirmed stop stand at any time, and the candidate's End always", () => {
    expect(byTool(tool("candidate_confirmed"), 240)).toBe(false);
    expect(byTool(tool("time_up"), 240, true)).toBe(false);
  });

  it("does not call a refused request, or no request, an early end: the client left, which is a drop", () => {
    expect(byTool(tool("time_up", true), 120)).toBe(false);
    expect(byTool(null, 120)).toBe(false);
  });

  it("keeps the goodbye words only for records of the old end_call tool", () => {
    // The same goodbye with 180 s left: early under end_call, and under the tool only by its reason.
    expect(isEarlyEnd({ endedBy: "agent", secondsLeft: 180, finishRequested: false, turns: [...base, agent(GOODBYE_ES)] })).toBe(true);
    expect(isEarlyEnd({ endedBy: "agent", secondsLeft: 50, finishRequested: false, turns: [...base, agent(GOODBYE_ES)] })).toBe(false);
    // A platform-side end is early by the clock alone, whoever spoke last.
    expect(isEarlyEnd({ endedBy: "platform", secondsLeft: 50, finishRequested: false, turns: [...base, agent(GOODBYE_ES)] })).toBe(true);
    expect(isEarlyEnd({ endedBy: "platform", secondsLeft: 50, finishRequested: false, turns: base })).toBe(true);
  });
});

describe("settleCallEnd: the interviewer's tool, the room's claim, the backup model", () => {
  const left = "Client disconnected: 1005";
  const settle = (input: Partial<Parameters<typeof settleCallEnd>[0]>) => settleCallEnd({ endedBy: "client", endCallReason: null, terminationReason: left, claim: null, ...input });

  it("stores an allowed tool call as the interviewer's end, with why", () => {
    expect(settle({ endTool: { reason: "time_up", refused: false }, claim: { reason: "interviewer", detail: "time_up", roomSeconds: 318.2 } })).toEqual({ reason: "interviewer", detail: "time_up", roomSeconds: 318.2, recorded: true });
    expect(settle({ endTool: { reason: "candidate_confirmed", refused: false } })).toMatchObject({ reason: "interviewer", detail: "confirmed" });
    // The record's tool call wins over what the room said about a later End.
    expect(settle({ endTool: { reason: "time_up", refused: false }, claim: { reason: "user", roomSeconds: 320 } })).toMatchObject({ reason: "interviewer", detail: "time_up", roomSeconds: 320 });
  });

  it("does not take a refused request for an end: the room's word, or a disconnect", () => {
    expect(settle({ endTool: { reason: "time_up", refused: true } })).toMatchObject({ reason: "disconnect", detail: left });
    expect(settle({ endTool: { reason: "time_up", refused: true }, claim: { reason: "user", roomSeconds: 200 } })).toMatchObject({ reason: "user", detail: null });
  });

  it("falls back to the room's claim when the record lost the tool turn, and only for the two details the room may give", () => {
    expect(settle({ claim: { reason: "interviewer", detail: "confirmed", roomSeconds: 150 } })).toMatchObject({ reason: "interviewer", detail: "confirmed", roomSeconds: 150 });
    expect(settle({ claim: { reason: "interviewer", detail: "time_up" } })).toMatchObject({ reason: "interviewer", detail: "time_up" });
    expect(settle({ claim: { reason: "interviewer", detail: "because I say so" } })).toMatchObject({ reason: "disconnect" });
    expect(settle({ claim: { reason: "interviewer" } })).toMatchObject({ reason: "disconnect" });
    expect(endToolFromClaim({ reason: "interviewer", detail: "confirmed" })).toEqual({ reason: "candidate_confirmed", refused: false });
    expect(endToolFromClaim({ reason: "interviewer", detail: "time_up" })).toEqual({ reason: "time_up", refused: false });
    for (const claim of [null, undefined, { reason: "interviewer" as const }, { reason: "interviewer" as const, detail: "other" }, { reason: "user" as const, detail: "time_up" }]) expect(endToolFromClaim(claim)).toBeNull();
  });

  it("counts the turns the backup model answered, and stays silent about none", () => {
    expect(settle({ backupTurns: 2 })).toMatchObject({ reason: "disconnect", backupTurns: 2 });
    expect(settle({ endedBy: "limit", backupTurns: 1 })).toEqual({ reason: "limit", detail: null, roomSeconds: null, recorded: true, backupTurns: 1 });
    expect(settle({ backupTurns: 0 })).not.toHaveProperty("backupTurns");
    expect(readCallEnd({ reason: "interviewer", detail: "time_up", recorded: true, backupTurns: 3 })).toMatchObject({ backupTurns: 3 });
    expect(readCallEnd({ reason: "interviewer", backupTurns: -1 })).toBeNull();
  });

  it("lets a late room report turn a stored disconnect into the interviewer's end, with one of its two details", () => {
    const dropped = { reason: "disconnect" as const, detail: left, roomSeconds: null, recorded: true };
    expect(withLateClaim(dropped, { reason: "interviewer", detail: "time_up", roomSeconds: 317 })).toEqual({ reason: "interviewer", detail: "time_up", roomSeconds: 317, recorded: true });
    expect(withLateClaim(dropped, { reason: "interviewer", detail: "confirmed", roomSeconds: 90 })).toMatchObject({ reason: "interviewer", detail: "confirmed" });
    // Without a known detail the claim only adds the room's clock.
    expect(withLateClaim(dropped, { reason: "interviewer", roomSeconds: 90 })).toEqual({ ...dropped, roomSeconds: 90 });
    expect(withLateClaim(dropped, { reason: "interviewer", detail: "anything", roomSeconds: 90 })).toEqual({ ...dropped, roomSeconds: 90 });
  });
});
