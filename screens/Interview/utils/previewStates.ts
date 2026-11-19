import type { TranscriptLine } from "@/components/interview/room/RoomTranscript";
import type { InterviewAgentProps, RoomPreview } from "../components/InterviewAgent";

/**
 * The dev room preview's states (/dev/room-preview?state=<name>): every state the room can be in, with invented
 * props, through the real InterviewAgent. Pure, so the e2e and the page read one table.
 */
export const PREVIEW_STATES = [
  // Before the call: what the start uses, and the language.
  "ready",
  "trial",
  "credit",
  "held",
  "mic-denied",
  // Starting.
  "microphone",
  "connecting",
  "queued",
  // Live: who holds the turn, the clock's last minute and the grace.
  "waiting",
  "speaking",
  "your-turn",
  "turns",
  "last-minute",
  "closing",
  "goodbye",
  "ending",
  // After a call that did not finish.
  "early-end",
  "dropped",
  "dropped-no-time",
  "silent-drop",
  // Nothing to start.
  "cap",
  "voice-down",
  "needs-pro",
  "needs-pro-had-voice",
  "needs-pro-claimed",
  "paused",
  "needs-pack",
  "past-due",
  // A purchase made from the room, still landing.
  "purchase-waiting",
  "confirming",
  "stalled",
] as const;

type PreviewState = (typeof PREVIEW_STATES)[number];

export const isPreviewState = (value: string | undefined): value is PreviewState => (PREVIEW_STATES as readonly string[]).includes(value ?? "");

/** The props a state sets; the page fills in the rest (role, company, offer). */
type PreviewProps = Pick<InterviewAgentProps, "entry" | "counts" | "startCount" | "maxDurationSeconds" | "resume" | "preview">;

type PreviewFixture = { calls: readonly TranscriptLine[]; turns: readonly TranscriptLine[] };

/** The scripted turns: a pause between two sentences, the hold, the answer, an interruption (ms from opening). */
export function turnScript(lines: readonly TranscriptLine[]): NonNullable<RoomPreview["turns"]> {
  const [question, answer, next] = lines;
  return [
    { at: 0, event: "connected" },
    { at: 600, event: "interviewer-line", line: question },
    { at: 600, event: "voice-start" },
    { at: 2_600, event: "voice-stop" },
    // 600 ms between two sentences: shorter than the hold, the turn stays the interviewer's.
    { at: 3_200, event: "voice-start" },
    // The question ends: the turn passes after the hold.
    { at: 5_000, event: "voice-stop" },
    // The platform ends the candidate's answer: the interviewer composes.
    { at: 9_000, event: "candidate-line", line: answer },
    { at: 10_600, event: "interviewer-line", line: next },
    { at: 10_600, event: "voice-start" },
    // The candidate cuts in: theirs at once.
    { at: 12_000, event: "interrupted" },
    { at: 12_050, event: "voice-stop" },
  ];
}

/** The 24-line live room, as the layout check and the transcript e2e open it (?drip=1 drips it, ?closing=1 is past the paid time). */
export function livePreview(fixture: PreviewFixture, { drip = false, closing = false, fullSeconds }: { drip?: boolean; closing?: boolean; fullSeconds: number }): PreviewProps {
  const calls = [...fixture.calls];
  return {
    ...continuing(fullSeconds),
    preview: {
      ...(drip ? { lines: calls.slice(0, 6), later: calls.slice(6), everyMs: 1_500 } : { lines: calls }),
      phase: "live",
      turn: "candidate",
      ...(closing ? { elapsed: fullSeconds + 10 } : {}),
    },
  };
}

/** An interview that already holds its unit (a call ran, or is running). */
function continuing(fullSeconds: number): Omit<PreviewProps, "preview"> {
  return { entry: { kind: "continue" }, counts: null, startCount: 1, maxDurationSeconds: fullSeconds, resume: null };
}

export function previewProps(state: PreviewState, fixture: PreviewFixture, { fullSeconds, trialSeconds }: { fullSeconds: number; trialSeconds: number }): PreviewProps {
  const calls = [...fixture.calls];
  const fresh: PreviewProps = {
    entry: { kind: "start", source: "period" },
    counts: { period: 3, periodLimit: 4, credits: 0 },
    startCount: 0,
    maxDurationSeconds: fullSeconds,
    resume: null,
    preview: { lines: [], phase: "idle" },
  };
  const live = (preview: Partial<RoomPreview>): PreviewProps => ({ ...continuing(fullSeconds), preview: { lines: calls, phase: "live", ...preview } });
  const blocked = (entry: InterviewAgentProps["entry"], preview: Partial<RoomPreview> = {}): PreviewProps => ({
    ...fresh,
    entry,
    counts: { period: 0, periodLimit: entry.kind === "needs-pack" ? 4 : 0, credits: 0 },
    maxDurationSeconds: 0,
    preview: { lines: [], phase: "idle", ...preview },
  });
  const after = (phase: RoomPreview["phase"], usedSeconds: number, startCount: number): PreviewProps => ({
    ...continuing(fullSeconds),
    startCount,
    resume: phase === "silent-drop" ? null : { usedSeconds, resumable: true, early: phase === "early-end" },
    preview: { lines: calls.slice(0, 8), phase },
  });
  const resetsAt = "2026-12-01T00:00:00.000Z";

  switch (state) {
    case "ready":
      return fresh;
    case "trial":
      return { ...fresh, entry: { kind: "start", source: "trial" }, counts: { period: 0, periodLimit: 0, credits: 0 }, maxDurationSeconds: trialSeconds };
    case "credit":
      return { ...fresh, entry: { kind: "start", source: "credit" }, counts: { period: 0, periodLimit: 4, credits: 2 } };
    case "held":
      return { ...fresh, entry: { kind: "continue" }, counts: null, startCount: 1 };
    case "mic-denied":
      return { ...fresh, preview: { lines: [], phase: "idle", problem: "denied" } };
    case "microphone":
    case "connecting":
    case "queued":
      return { ...fresh, preview: { lines: [], phase: state } };
    case "waiting":
      return live({ turn: "waiting" });
    case "speaking":
      return live({ turn: "interviewer" });
    case "your-turn":
      return live({ turn: "candidate" });
    case "turns":
      return live({ lines: calls.slice(0, 4), turns: turnScript(fixture.turns) });
    case "last-minute":
      return live({ turn: "candidate", elapsed: fullSeconds - 50 });
    case "closing":
      return live({ turn: "candidate", elapsed: fullSeconds + 10 });
    case "goodbye":
      // The candidate asked to stop and confirmed: the goodbye with paid time left.
      return live({ turn: "interviewer", elapsed: fullSeconds - 200, goodbye: true });
    case "ending":
      return { ...continuing(fullSeconds), preview: { lines: calls, phase: "ending" } };
    case "early-end":
      return after("early-end", fullSeconds - 123, 1);
    case "dropped":
      return after("dropped", 192, 2);
    case "dropped-no-time":
      return after("dropped", fullSeconds - 20, 1);
    case "silent-drop":
      return { ...after("silent-drop", 0, 1), preview: { lines: [], phase: "silent-drop" } };
    case "cap":
      return { ...fresh, entry: { kind: "start-cap" }, startCount: 3 };
    case "voice-down":
      return { ...fresh, entry: { kind: "voice-down" } };
    case "needs-pro":
      return blocked({ kind: "needs-pro", reason: "trial-used" });
    case "needs-pro-had-voice":
      return blocked({ kind: "needs-pro", reason: "had-voice" });
    case "needs-pro-claimed":
      return blocked({ kind: "needs-pro", reason: "trial-claimed" });
    case "paused":
      return blocked({ kind: "needs-pro", reason: "had-voice", subscription: "paused" });
    case "needs-pack":
      return blocked({ kind: "needs-pack", resetsAt });
    case "past-due":
      return blocked({ kind: "needs-pack", resetsAt, pastDue: true });
    case "purchase-waiting":
      return blocked({ kind: "needs-pro", reason: "trial-used" }, { purchase: "waiting" });
    case "confirming":
      return blocked({ kind: "needs-pro", reason: "trial-used" }, { purchase: "confirming" });
    case "stalled":
      return blocked({ kind: "needs-pro", reason: "trial-used" }, { purchase: "stalled" });
  }
}
