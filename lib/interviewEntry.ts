import type { EntitlementSource, InterviewEntitlement } from "@/lib/interviewEntitlement";

/**
 * What the interview room offers on entry, before any button is pressed.
 * The session endpoint stays the authority (it refuses at Start whatever
 * a stale page shows); this only decides what a fresh page says, from the
 * same entitlement the endpoint runs. Import-free beyond types, so the
 * room, the analysis page and the interviews list read one rule.
 */
export type RoomEntry =
  /** Every start of this interview is used. */
  | { kind: "start-cap" }
  /** Voice is down (rejected key, balance under the floor): nothing to start, nothing to buy. */
  | { kind: "voice-down" }
  /** The interview already holds its unit, or a dropped call can be resumed: no new unit is used. */
  | { kind: "continue" }
  /** A fresh start, paid by this source. */
  | { kind: "start"; source: Exclude<EntitlementSource, "none"> }
  /** Free with the trial used (or never offered) and no credits. */
  | { kind: "needs-pro"; reason: "trial-used" | "had-voice" }
  /** Pro with the period's interviews used and no credits. */
  | { kind: "needs-pack"; resetsAt: string };

export type RoomEntryFacts = {
  startCount: number;
  maxStarts: number;
  /** The interview holds a reserved unit (a reconnect reuses it). */
  held: boolean;
  /** A dropped call that a reconnect continues. */
  resumable: boolean;
  /** What a fresh start would get; null when the interview holds its unit and nothing else was read. */
  entitlement: InterviewEntitlement | null;
  /** Null when not checked (the lists): only the room asks the platform. */
  voiceUp: boolean | null;
};

export function decideRoomEntry(facts: RoomEntryFacts): RoomEntry {
  if (facts.startCount >= facts.maxStarts) return { kind: "start-cap" };
  if (facts.voiceUp === false) return { kind: "voice-down" };
  if (facts.held || facts.resumable) return { kind: "continue" };
  const entitlement = facts.entitlement;
  if (entitlement && entitlement.source !== "none") return { kind: "start", source: entitlement.source };
  if (entitlement?.plan === "PRO" && entitlement.resetsAt) return { kind: "needs-pack", resetsAt: entitlement.resetsAt };
  return { kind: "needs-pro", reason: entitlement?.reason === "had-voice" ? "had-voice" : "trial-used" };
}

/** Whether a start is on offer: what the lists and the analysis page show for a waiting interview. */
export function entryCanStart(entry: RoomEntry): boolean {
  return entry.kind === "continue" || entry.kind === "start";
}

/** The facts of a waiting interview row, without the room's own reads. */
export type WaitingInterview = {
  startCount: number;
  held: boolean;
  resumableUntil: Date | string | null;
};

/** What a list says of a waiting interview: ready, or what it lacks. */
export type WaitingReading = "ready" | "needsPro" | "needsPack" | "noStarts";

export function waitingReading(entry: RoomEntry): WaitingReading {
  if (entry.kind === "needs-pro") return "needsPro";
  if (entry.kind === "needs-pack") return "needsPack";
  if (entry.kind === "start-cap") return "noStarts";
  return "ready";
}

export function waitingInterviewEntry(row: WaitingInterview, entitlement: InterviewEntitlement, maxStarts: number, now = new Date()): RoomEntry {
  const until = row.resumableUntil === null ? null : new Date(row.resumableUntil);
  return decideRoomEntry({
    startCount: row.startCount,
    maxStarts,
    held: row.held,
    resumable: until !== null && until.getTime() > now.getTime(),
    entitlement,
    voiceUp: null,
  });
}
