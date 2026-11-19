import { describe, expect, it } from "vitest";
import { foldTurn, readTurn, stepTurn, TURN_START, type Turn } from "@/components/interview/room/turn";
import { isPreviewState, PREVIEW_STATES, previewProps, turnScript } from "./previewStates";

const LINES = [
  { role: "agent" as const, text: "Question." },
  { role: "user" as const, text: "Answer." },
  { role: "agent" as const, text: "Next question." },
];
const FIXTURE = { calls: LINES, turns: LINES };
const SECONDS = { fullSeconds: 720, trialSeconds: 300 };

describe("the room preview's states", () => {
  it("knows every state it lists, and nothing else", () => {
    for (const state of PREVIEW_STATES) expect(isPreviewState(state)).toBe(true);
    expect(isPreviewState("nope")).toBe(false);
    expect(isPreviewState(undefined)).toBe(false);
  });

  it.each(PREVIEW_STATES)("%s: a preview, so the room never calls the platform or the server", (state) => {
    expect(previewProps(state, FIXTURE, SECONDS).preview).toBeDefined();
  });

  it("scripts a call whose turn goes interviewer, candidate, interviewer composing, interviewer, candidate (cut in)", () => {
    const script = turnScript(LINES);
    const events = script.map(({ at, event }) => ({ at, event }));
    const seen: Turn[] = [];
    // The room opens on the interviewer's turn (useTurn with `opening`), then steps through the script.
    for (let now = 0; now <= 14_000; now += 20) {
      const turn = readTurn(foldTurn([{ at: -1, event: "connected" }, ...events], now), now).turn;
      if (turn !== seen.at(-1)) seen.push(turn);
    }
    expect(seen).toEqual(["waiting", "interviewer", "candidate", "waiting", "interviewer", "candidate"]);
    expect(script.filter((step) => step.line).map((step) => step.line)).toEqual(LINES);
    expect(stepTurn(TURN_START, "connected", 0).phase).toBe("waiting");
  });
});
