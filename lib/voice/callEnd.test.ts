import { describe, expect, it } from "vitest";
import { candidateConfirmedStop, endsUnanswered, isEarlyEnd, readCallEnd, saidGoodbye, settleCallEnd, type PlatformEnd } from "./callEnd";

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
    const english = [agent("Do you want to end the interview now?"), user("Yes, please.")];
    expect(candidateConfirmedStop(english)).toBe(true);
    expect(candidateConfirmedStop([agent("Do you want to end the interview now?"), user("Not yet, let's continue.")])).toBe(false);
  });
});

describe("isEarlyEnd", () => {
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

  it("reads back only what it wrote", () => {
    expect(readCallEnd({ reason: "interviewer", detail: "done", roomSeconds: 12, recorded: true })).toMatchObject({ reason: "interviewer" });
    expect(readCallEnd({ reason: "nonsense" })).toBeNull();
    expect(readCallEnd(null)).toBeNull();
  });
});
