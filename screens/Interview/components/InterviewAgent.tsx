"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { textLinkClass } from "@/components/design-system/Button";
import { RoomButton } from "@/components/interview/room/RoomButton";
import type { TranscriptLine } from "@/components/interview/room/RoomTranscript";
import { PanelLine, PanelSub, RoomView, TURN_STATUS, type RoomClock, type RoomFacts, type RoomNotice, type RoomStatus } from "@/components/interview/room/RoomView";
import { speechLevel } from "@/components/interview/room/levels";
import type { Turn, TurnEvent } from "@/components/interview/room/turn";
import type { MeterLevels } from "@/components/interview/room/VoiceMeter";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import type { InterviewLanguage } from "@/lib/ai/postingLanguage";
import type { RoomEntry } from "@/lib/interviewEntry";
import type { InterviewSessionResponse } from "@/lib/schemas/interviewSessionSchema";
import { cn } from "@/lib/utils";
import { useTurn } from "../hooks/useTurn";
import {
  countdownNoticeKey,
  countdownPhase,
  formatClock,
  remainingSeconds,
} from "../utils/countdown";
import { reportInterviewEnded, requestInterviewSession } from "../utils/session";
import { decideEndTool, END_ALLOWED_QUIET, isEarlyEnd, questionPending, saidGoodbye, type EndToolDecision, type RoomEndClaim } from "@/lib/voice/callEnd";
import { roomHangUpSeconds, stepClosing, TURN_TEXT_WAIT_MS, waitsForTurnText, type ClosingState } from "../utils/closing";
import { dueTimeNote, type TimeNoteId } from "@/lib/voice/timeNotes";
import { hasWords } from "@/lib/voice/transcript";
import { useVoiceCall, VoiceCallProvider } from "./elevenlabs/VoiceCall";
import RoomOffer, { type PurchasePreview, type RoomOfferFacts } from "./RoomOffer";

/** Why the microphone could not be opened; each has its copy under room.microphone. */
type MicProblem = "insecure" | "denied" | "missing" | "failed";

/** Where a preview opens: the room's phases, named as the dev preview names them. */
type PreviewPhase = "idle" | "microphone" | "session" | "connecting" | "queued" | "live" | "ending" | "dropped" | "early-end" | "silent-drop";

/** Dev-only layout harness (/dev/room-preview): a room in any state, with invented lines; never calls the platform or the server. */
export type RoomPreview = {
  lines: TranscriptLine[];
  /** Lines that arrive one by one, as in a call. */
  later?: TranscriptLine[];
  everyMs?: number;
  /** Live unless said otherwise. */
  phase?: PreviewPhase;
  /** Who holds the turn in a live preview. */
  turn?: Turn;
  /** The call's turn events (and the line each brings), replayed from the moment the preview opens. */
  turns?: { at: number; event: TurnEvent; line?: TranscriptLine }[];
  /** Seconds of the call already used. */
  elapsed?: number;
  /** The interviewer is saying the goodbye the room allowed. */
  goodbye?: boolean;
  /** The microphone's refusal, as the room shows it. */
  problem?: MicProblem;
  /** A purchase made from the room, still landing. */
  purchase?: PurchasePreview;
};

export type InterviewAgentProps = {
  interviewId: string;
  role: string;
  company: string;
  /** Clerk first name; null when the account has none. */
  candidateName: string | null;
  /** Where the cap message sends the candidate to rehearse again. */
  analysisId: string;
  /** Which rehearsal of the analysis this is. */
  attemptNumber: number;
  /**
   * Starts (connections) already issued for this interview, and the cap.
   * A different counter from the attempt: it exists for dropped calls.
   */
  startCount: number;
  maxStarts: number;
  /** The agent's hard limit; the session response repeats it. */
  maxDurationSeconds: number;
  /** The language the room proposes: the interview's when one was chosen, the posting's otherwise. */
  language: InterviewLanguage;
  /** Set when an earlier call of this interview dropped: how much of its length is used, and whether a reconnect continues it. */
  resume: { usedSeconds: number; resumable: boolean; early?: boolean } | null;
  /** What the room offers on entry (the server's reading of the entitlement and voice health); Start stays the authority. */
  entry: RoomEntry;
  /** The entitlement's counts, for the line that says what a start uses; null when the interview already holds its unit. */
  counts: { period: number; periodLimit: number; credits: number } | null;
  /** The plans and prices an offer names, from config. */
  offer: RoomOfferFacts;
  /** Dev-only layout harness (/dev/room-preview): opens in the given state, never calls the platform or the server. */
  preview?: RoomPreview;
  /** Dev tools only: window.__cvisionRoom lets the voice e2e send a [time] line and a typed candidate line. */
  devHooks?: boolean;
};

type BlockedEntry = Extract<RoomEntry, { kind: "needs-pro" | "needs-pack" | "voice-down" }>;
const isBlocked = (entry: RoomEntry): entry is BlockedEntry => entry.kind === "needs-pro" || entry.kind === "needs-pack" || entry.kind === "voice-down";

/**
 * The interview room. The browser never holds a key: Start asks the server
 * for a session, and the server answers with a single-use conversation token
 * and the variables it issued, which go to the SDK untouched. What the
 * candidate says is transcribed by the platform and delivered to the server
 * by webhook; the transcript shown here is for the candidate's eyes and is
 * never sent anywhere. What it looks like is components/interview/room
 * (the landing plays the same view from a script).
 */
export default function InterviewAgent(props: InterviewAgentProps) {
  return (
    <VoiceCallProvider>
      <InterviewRoom {...props} />
    </VoiceCallProvider>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "starting"; step: "microphone" | "session" | "connecting" | "queued" }
  | { kind: "live" }
  | { kind: "ending" }
  | { kind: "ended" }
  // silent: the call dropped before the candidate said anything, so the next start is a fresh one.
  // early: the platform ended the call with paid time left; that time is still the candidate's.
  | { kind: "dropped"; silent?: boolean; early?: boolean };

const PREVIEW_PHASES: Record<PreviewPhase, Phase> = {
  idle: { kind: "idle" },
  microphone: { kind: "starting", step: "microphone" },
  session: { kind: "starting", step: "session" },
  connecting: { kind: "starting", step: "connecting" },
  queued: { kind: "starting", step: "queued" },
  live: { kind: "live" },
  ending: { kind: "ending" },
  dropped: { kind: "dropped" },
  "early-end": { kind: "dropped", early: true },
  "silent-drop": { kind: "dropped", silent: true },
};

function initialPhase(preview: RoomPreview | undefined, resume: InterviewAgentProps["resume"]): Phase {
  if (preview) return PREVIEW_PHASES[preview.phase ?? "live"];
  return resume ? { kind: "dropped", early: resume.early === true } : { kind: "idle" };
}

/**
 * Asks for the microphone before anything is paid for: a denied permission
 * costs nothing, while a session issued and never joined costs a start. The
 * SDK asks again when the session starts; by then the answer is remembered.
 */
async function requestMicrophone(): Promise<MicProblem | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "insecure";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return null;
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return "denied";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
    return "failed";
  }
}

/** The call always reports its end after endCall; this is the belt for a hook that never fires. */
const END_FALLBACK_MS = 5_000;

const userLineCount = (lines: TranscriptLine[]) => lines.filter((line) => line.role === "user").length;

/** Less than this left after a drop is not worth a call (the server refuses it too). */
const MIN_RESUME_SECONDS = 30;

function InterviewRoom({
  interviewId,
  role,
  company,
  candidateName,
  analysisId,
  attemptNumber,
  startCount,
  maxStarts,
  maxDurationSeconds,
  language: proposedLanguage,
  resume,
  entry,
  counts,
  offer,
  preview,
  devHooks,
}: InterviewAgentProps) {
  const router = useRouter();
  const { t } = useTranslation("interview");
  const errorCopy = useErrorCopy();
  const [phase, setPhase] = useState<Phase>(() => initialPhase(preview, resume));
  const [language, setLanguage] = useState<InterviewLanguage>(proposedLanguage);
  // Seconds of the interview used by earlier calls; the clock after a drop starts from what is left.
  const [usedBefore, setUsedBefore] = useState(resume?.usedSeconds ?? 0);
  const [finishing, setFinishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(() => (preview?.problem ? t(`room.microphone.${preview.problem}`) : null));
  const [startsUsed, setStartsUsed] = useState(startCount);
  const [session, setSession] = useState<InterviewSessionResponse | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(() =>
    preview && (preview.phase ?? "live") === "live" ? Date.now() - (preview.elapsed ?? 0) * 1000 : null,
  );
  const [now, setNow] = useState(() => Date.now());
  const [lines, setLines] = useState<TranscriptLine[]>(() => preview?.lines ?? []);

  // The SDK's callbacks fire outside React's render; they read the phase
  // through a ref so a callback registered on an earlier render sees the
  // current one.
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // What the end-of-call callback needs from the latest render.
  const callRef = useRef<{ connectedAt: number | null; callSeconds: number }>({ connectedAt: null, callSeconds: maxDurationSeconds });
  // The [time] lines already sent in this call (utils/timeNotes.ts).
  const notesSent = useRef(new Set<TimeNoteId>());
  // The candidate has spoken in some call of this interview: only then does a drop use up time.
  const spoke = useRef(resume !== null);
  const startsUsedRef = useRef(startCount);
  // The live lines, for the end-of-call callback.
  const linesRef = useRef<TranscriptLine[]>([]);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  // Who hangs up when the room does: the candidate's End, the room's own clock, or the interviewer's allowed tool.
  const endingBy = useRef<"user" | "room" | "interviewer">("user");
  // The end the room allowed: why, when, and whether the goodbye has been heard starting.
  // held: the tool calls the room has allowed and not answered; it hangs up instead, and answers only to ask for a goodbye it has not heard.
  const closing = useRef<(ClosingState & { held: ((result: string) => void)[] }) | null>(null);
  const releaseHeld = useCallback(() => {
    const state = closing.current;
    if (!state) return;
    for (const answer of state.held.splice(0)) answer(state.result);
  }, []);
  const [closingAt, setClosingAt] = useState<number | null>(() => (preview?.goodbye ? Date.now() : null));
  const modeRef = useRef<string>("listening");
  // End requests waiting for the interviewer's next line.
  const lineWaiters = useRef(new Set<() => void>());

  // Who holds the turn, from the call's events; it reads the microphone through a ref filled once the call hook exists.
  const micLevel = useRef<() => number>(() => 0);
  const readMic = useCallback(() => micLevel.current(), []);
  const callTurn = useTurn(readMic, Boolean(preview?.turns));
  const pushTurn = callTurn.push;

  // The room's answer to end_interview once it has decided; an allowed end is held until the goodbye was heard.
  const answerEndRequest = (reason: unknown, { elapsed, callSeconds, decision }: { elapsed: number; callSeconds: number; decision: EndToolDecision }): string | Promise<string> => {
    // For support: never the candidate's words.
    const verdict = decision.allow ? `allowed (${decision.detail}${decision.awaitAnswer ? ", after the answer" : ""})` : `refused (${decision.silent ? "silent" : "spoken"})`;
    console.info(`[CVision][room] end_interview reason=${typeof reason === "string" ? reason : "?"} at=${Math.round(elapsed)}s left=${Math.round(callSeconds - elapsed)}s: ${verdict}`);
    if (!decision.allow || phaseRef.current.kind !== "live") return decision.result;
    // Allowed: the room hangs up once the goodbye that came with the call has been spoken, and answers only if none is heard.
    const speaking = modeRef.current === "speaking";
    return new Promise<string>((resolve) => {
      // Already closing (the goodbye's line came first, or a second call): held with the first.
      if (closing.current) {
        closing.current.held.push(resolve);
        return;
      }
      closing.current = {
        detail: decision.detail,
        at: Date.now(),
        spoke: decision.goodbyeSaid || speaking,
        quietSince: decision.goodbyeSaid && !speaking ? Date.now() : null,
        held: [resolve],
        result: decision.result,
        awaitAnswer: decision.awaitAnswer,
        userLines: userLineCount(linesRef.current),
      };
      setClosingAt(Date.now());
    });
  };

  const endFallback = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (endFallback.current !== null) window.clearTimeout(endFallback.current);
    };
  }, []);

  const feedbackHref = `/interview/${interviewId}/feedback?ended=1`;

  const goToFeedback = useCallback(() => {
    setPhase({ kind: "ended" });
    // A preview has no interview to open.
    if (!preview) router.push(feedbackHref);
  }, [router, feedbackHref, preview]);

  const failStart = useCallback((copy: string) => {
    setNotice(copy);
    setPhase({ kind: "idle" });
  }, []);

  const { start: startCall, end: endCall, notify, say, candidateLevel, interviewerLevel, mode } = useVoiceCall({
    onConnect: () => {
      notesSent.current = new Set();
      closing.current = null;
      setClosingAt(null);
      setConnectedAt(Date.now());
      setNow(Date.now());
      setNotice(null);
      setPhase({ kind: "live" });
      // The interviewer opens the call: its turn, silent until the greeting plays.
      pushTurn("connected");
      if (modeRef.current === "speaking") pushTurn("voice-start");
    },
    onEnd: (end) => {
      // A tool call still held open has nobody left to answer.
      releaseHeld();
      const at = phaseRef.current;
      const current = at.kind;
      if (current === "ended") return;

      // The call never began: refused for capacity, or the wait in line ran out. Nothing to resume.
      const neverBegan = current === "starting";
      // The candidate pressed End, or the SDK says they hung up: their decision to finish.
      const finished = current === "ending" || end.reason === "user";
      // An end by the interviewer that cut the candidate off is not the end (the server runs the same rule).
      const { connectedAt: began, callSeconds } = callRef.current;
      const elapsedExact = began === null ? 0 : Math.max(0, (Date.now() - began) / 1000);
      const elapsed = Math.floor(elapsedExact);
      // Only the room hangs up now: an end from the other side with paid time left is the platform's (a silence timeout, an error).
      const early =
        current === "live" &&
        end.reason === "agent" &&
        spoke.current &&
        isEarlyEnd({ endedBy: "platform", secondsLeft: callSeconds - elapsed, finishRequested: false, turns: linesRef.current.map((line) => ({ role: line.role, message: line.text })) });
      const dropped = early || (!neverBegan && !finished && !end.finished);
      const claim: RoomEndClaim =
        // The other side cannot hang up as the interviewer any more: an end from there is the platform's, and the record names it.
        current === "ending" ? endingBy.current : end.reason === "user" ? "user" : end.limit ? "limit" : "disconnect";

      // The server learns now that the call is over, why the room thinks so and how long it ran. Not awaited.
      // An end the interviewer asked for is not the candidate's Finish: the record decides whether it stands.
      const byInterviewer = current === "ending" && endingBy.current === "interviewer";
      void reportInterviewEnded(interviewId, end.reason, fetch, byInterviewer ? undefined : finished ? "finish" : dropped ? "drop" : undefined, {
        end: claim,
        ...(byInterviewer && closing.current ? { endDetail: closing.current.detail } : {}),
        elapsedSeconds: Math.round(elapsedExact * 10) / 10,
      });

      if (neverBegan) {
        failStart(errorCopy(end.busy || at.step === "queued" ? "VOICE_BUSY" : "VOICE_UNAVAILABLE"));
        return;
      }
      if (early) {
        // The server gives this start back: the interviewer's mistake does not cost a connection.
        startsUsedRef.current = Math.max(0, startsUsedRef.current - 1);
        setStartsUsed((used) => Math.max(0, used - 1));
        setUsedBefore(Math.min(maxDurationSeconds, maxDurationSeconds - callSeconds + elapsed));
        setPhase({ kind: "dropped", early: true });
        return;
      }
      if (finished || end.finished) {
        goToFeedback();
        return;
      }
      // Dropped before the candidate said anything: the server starts the next call fresh, and so does the room.
      if (!spoke.current) {
        // With no start left there is nothing to start again: the feedback page says nothing was charged.
        if (startsUsedRef.current >= maxStarts) goToFeedback();
        else setPhase({ kind: "dropped", silent: true });
        return;
      }
      // A drop: what this call used comes off the interview's length.
      setUsedBefore(Math.min(maxDurationSeconds, maxDurationSeconds - callSeconds + elapsed));
      setPhase({ kind: "dropped" });
    },
    onQueue: (status) => {
      // In line: the clock does not run and nothing is charged until an interviewer is free.
      if (status === "waiting") {
        setConnectedAt(null);
        setPhase({ kind: "starting", step: "queued" });
        return;
      }
      setConnectedAt(Date.now());
      setNow(Date.now());
      setPhase({ kind: "live" });
      pushTurn("connected");
    },
    onEndRequest: (reason) => {
      const decide = () => {
        const { connectedAt: began, callSeconds } = callRef.current;
        const elapsed = began === null ? 0 : (Date.now() - began) / 1000;
        // Once the time-up line went out the paid time is over, whatever a late tick says.
        const paidSecondsLeft = notesSent.current.has("up") ? 0 : callSeconds - elapsed;
        return { elapsed, callSeconds, decision: decideEndTool({ reason, paidSecondsLeft, turns: linesRef.current.map((line) => ({ role: line.role, message: line.text })) }) };
      };
      const first = decide();
      if (!waitsForTurnText(first.decision, linesRef.current.at(-1)?.role)) return answerEndRequest(reason, first);
      // The question this call came with may not have arrived yet: choose silent or spoken once it has, or after the wait.
      return new Promise<string>((resolve) => {
        const finish = () => {
          window.clearTimeout(timer);
          lineWaiters.current.delete(arrived);
          resolve(answerEndRequest(reason, decide()));
        };
        const arrived = () => {
          if (linesRef.current.at(-1)?.role === "agent") finish();
        };
        const timer = window.setTimeout(finish, TURN_TEXT_WAIT_MS);
        lineWaiters.current.add(arrived);
      });
    },
    onError: (message) => {
      // The SDK's own message: about the session, never about the candidate.
      console.error("[CVision][room] voice session error:", message);
      if (phaseRef.current.kind === "starting") failStart(errorCopy("VOICE_UNAVAILABLE"));
    },
    onLine: ({ role: speaker, text }) => {
      if (!hasWords(text)) return;
      if (speaker === "user") spoke.current = true;
      setLines((prev) => [...prev, { role: speaker, text }]);
      // A refusal waiting for this turn's text reads the ref before React renders.
      linesRef.current = [...linesRef.current, { role: speaker, text }];
      for (const wake of [...lineWaiters.current]) wake();
      // The interviewer's line comes as it starts speaking; the candidate's once the platform ends their turn.
      pushTurn(speaker === "agent" ? "interviewer-line" : "candidate-line");
    },
    // An interrupted agent line is reported as what was planned, then
    // corrected to what was actually said.
    onLineCorrected: ({ original, corrected }) => {
      pushTurn("interrupted");
      setLines((prev) => {
        const index = prev.findLastIndex((line) => line.role === "agent" && line.text === original);
        if (index < 0) return prev;
        // Cut off before its first word ("..."): nothing was said, so the line goes.
        if (!hasWords(corrected)) return prev.filter((_, at) => at !== index);
        const next = prev.slice();
        next[index] = { role: "agent", text: corrected };
        return next;
      });
    },
    onInterrupted: () => pushTurn("interrupted"),
  });

  useEffect(() => {
    micLevel.current = candidateLevel;
  }, [candidateLevel]);

  const handleStart = async () => {
    // A preview has nothing to start.
    if (preview) return;
    setNotice(null);
    setLines([]);
    setConnectedAt(null);
    setPhase({ kind: "starting", step: "microphone" });

    const micProblem = await requestMicrophone();
    if (micProblem) {
      failStart(t(`room.microphone.${micProblem}`));
      return;
    }

    setPhase({ kind: "starting", step: "session" });
    // The drop's own report may have died with the connection: say it again, so the server fetches that call first.
    if (usedBefore > 0) await reportInterviewEnded(interviewId, "reconnect", fetch, "drop");
    const result = await requestInterviewSession(interviewId, fetch, language);
    if (!result.ok) {
      // The interview's time ran out, or it was closed meanwhile: its feedback is the next page.
      if (result.code === "INTERVIEW_NOT_STARTABLE" && usedBefore > 0) {
        goToFeedback();
        return;
      }
      if (result.code === "INTERVIEW_START_LIMIT") {
        setStartsUsed(maxStarts);
        startsUsedRef.current = maxStarts;
      }
      failStart(errorCopy(result.code));
      return;
    }

    // The server recorded the start when it answered; from here on it counts.
    setStartsUsed((used) => used + 1);
    startsUsedRef.current += 1;
    setSession(result.data);
    setPhase({ kind: "starting", step: "connecting" });
    startCall({ token: result.data.conversationToken, variables: result.data.dynamicVariables, language: result.data.language });
  };

  const hangUp = useCallback(
    (by: "user" | "room" | "interviewer") => {
      if (phaseRef.current.kind !== "live") return;
      endingBy.current = by;
      // The callbacks read the phase by ref: a second hang-up in the same tick must see this one.
      phaseRef.current = { kind: "ending" };
      setPhase({ kind: "ending" });
      // A preview has no call to end.
      if (preview) return;
      endCall();
      endFallback.current = window.setTimeout(() => {
        if (phaseRef.current.kind === "ending") goToFeedback();
      }, END_FALLBACK_MS);
    },
    [endCall, goToFeedback, preview],
  );

  const handleEnd = () => hangUp("user");

  // After a drop: close the interview with what was said, and go to its feedback.
  const handleFinish = async () => {
    if (preview) return;
    setFinishing(true);
    await reportInterviewEnded(interviewId, "finish", fetch, "finish");
    goToFeedback();
  };

  // The dev preview's call shape: the rest of its lines arrive one by one, as in a call.
  useEffect(() => {
    const later = preview?.later;
    if (!later || later.length === 0) return;
    let next = 0;
    const timer = window.setInterval(() => {
      if (next >= later.length) return window.clearInterval(timer);
      const line = later[next++];
      setLines((prev) => [...prev, line]);
    }, preview.everyMs ?? 1_500);
    return () => window.clearInterval(timer);
  }, [preview]);

  // The dev preview's scripted turns: the events of a call, with the lines they bring, at their times.
  useEffect(() => {
    const script = preview?.turns;
    if (!script || script.length === 0) return;
    const timers = script.map(({ at, event, line }) =>
      window.setTimeout(() => {
        if (line) setLines((prev) => [...prev, line]);
        pushTurn(event);
      }, at),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [preview, pushTurn]);

  // A tab closed mid-call: tell the server on the way out, so the interview is resumable at once.
  useEffect(() => {
    if (phase.kind !== "live" || preview) return;
    const leave = () => {
      const began = callRef.current.connectedAt;
      void reportInterviewEnded(interviewId, "pagehide", fetch, "drop", { end: "disconnect", elapsedSeconds: began === null ? 0 : Math.max(0, Math.round((Date.now() - began) / 100) / 10) });
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [phase.kind, interviewId, preview]);

  // The clock ticks only while the call is live.
  useEffect(() => {
    if (phase.kind !== "live") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [phase.kind]);

  const live = phase.kind === "live";
  const starting = phase.kind === "starting";
  const atCap = startsUsed >= maxStarts;
  const startsLeft = Math.max(0, maxStarts - startsUsed);
  const dropped = phase.kind === "dropped";
  const silentDrop = phase.kind === "dropped" && phase.silent === true;
  const earlyEnd = phase.kind === "dropped" && phase.early === true;

  // Before Start the length comes from the entitlement the page read; after
  // it, from the session the server issued. They differ only when the facts
  // changed in between (a credit spent in another tab): the session wins,
  // and the room says so rather than jumping silently.
  const leftAfterDrop = Math.max(0, maxDurationSeconds - usedBefore);
  const callSeconds = session?.maxDurationSeconds ?? (usedBefore > 0 ? leftAfterDrop : maxDurationSeconds);
  const maxSeconds = dropped ? leftAfterDrop : callSeconds;
  const canResume = dropped && startsLeft > 0 && leftAfterDrop >= MIN_RESUME_SECONDS;
  const blocked = isBlocked(entry);
  // What the next start uses, said before it: after a session the server's answer is the truth.
  const sourceLine = session
    ? null
    : entry.kind === "continue"
      ? t("room.source.held")
      : entry.kind !== "start"
        ? null
        : entry.source === "trial"
          ? t("room.source.trial", { minutes: Math.round(maxDurationSeconds / 60) })
          : entry.source === "period"
            ? t("room.source.period", { count: counts?.period ?? 0, limit: counts?.periodLimit ?? 0 })
            : t("room.source.credit", { count: counts?.credits ?? 0 });
  const lengthChanged = session !== null && !session.resumed && maxDurationSeconds > 0 && session.maxDurationSeconds !== maxDurationSeconds;
  const remaining =
    live && connectedAt !== null ? remainingSeconds(maxSeconds, connectedAt, now) : maxSeconds;
  // The paid time is over: the call runs on through the grace, and the clock says so instead of counting.
  const timeUp = live && connectedAt !== null && remaining <= 0;
  const sayingGoodbye = live && closingAt !== null;
  const clockPhase = live ? countdownPhase(remaining) : "normal";
  // The warnings follow the interface language, not the language the session speaks.
  const clockNoticeKey = live ? countdownNoticeKey(clockPhase) : null;

  // The tool's callback reads who is speaking by ref; the turn hears the interviewer's audio start and stop.
  useEffect(() => {
    if (modeRef.current === mode) return;
    modeRef.current = mode;
    if (phaseRef.current.kind === "live" && !preview) pushTurn(mode === "speaking" ? "voice-start" : "voice-stop");
  }, [mode, preview, pushTurn]);

  const queued = phase.kind === "starting" && phase.step === "queued";

  useEffect(() => {
    callRef.current = { connectedAt, callSeconds };
  }, [connectedAt, callSeconds]);

  // The interviewer has no clock: the room sends it the [time] lines, and
  // hangs up itself when a call runs past its paid length and the grace.
  const elapsedLive = live && connectedAt !== null ? Math.floor((now - connectedAt) / 1000) : 0;
  useEffect(() => {
    if (!live || preview) return;
    const note = dueTimeNote(callSeconds, elapsedLive, notesSent.current);
    if (note) {
      notesSent.current.add(note.id);
      notify(note.text);
    }
    // The platform cuts a first call at the tier's length plus the grace; the room enforces what is left of a resumed one.
    if (elapsedLive >= roomHangUpSeconds(callSeconds, session?.resumed === true)) hangUp("room");
  }, [live, preview, elapsedLive, callSeconds, notify, hangUp, session?.resumed]);

  // The end the room allowed: it hangs up once the goodbye has been spoken.
  useEffect(() => {
    if (!live || preview) return;
    // The time is up and the interviewer said the goodbye without asking the room: the same end.
    const turns = lines.map((line) => ({ role: line.role, message: line.text }));
    if (closing.current === null && notesSent.current.has("up") && saidGoodbye(turns)) {
      closing.current = {
        detail: "time_up",
        at: Date.now(),
        spoke: true,
        quietSince: mode === "speaking" ? null : Date.now(),
        held: [],
        result: END_ALLOWED_QUIET,
        awaitAnswer: questionPending(turns),
        userLines: userLineCount(lines),
      };
      setClosingAt(Date.now());
      return;
    }
    const current = closing.current;
    if (!current) return;
    const step = stepClosing(current, { now: Date.now(), speaking: mode === "speaking", userLines: userLineCount(lines), candidateLevel: current.awaitAnswer ? candidateLevel() : 0 });
    closing.current = { ...step.state, held: current.held };
    if (step.release) releaseHeld();
    if (step.hangUp) {
      hangUp("interviewer");
      return;
    }
    // Checked again shortly: the mode changes between clock ticks.
    const timer = window.setTimeout(() => setNow(Date.now()), 300);
    return () => window.clearTimeout(timer);
  }, [live, preview, mode, now, closingAt, lines, hangUp, releaseHeld, candidateLevel]);

  // Dev tools: the voice e2e drives the interviewer's side from here.
  useEffect(() => {
    if (!devHooks) return;
    const hooks = { note: (text: string) => notify(text), say: (text: string) => say(text) };
    (window as unknown as { __cvisionRoom?: typeof hooks }).__cvisionRoom = hooks;
    return () => {
      delete (window as unknown as { __cvisionRoom?: typeof hooks }).__cvisionRoom;
    };
  }, [devHooks, notify, say]);

  // Who holds the turn: the call's events, or what the preview sets.
  const turn: Turn = preview?.turn ?? callTurn.turn;
  const voiceOn = preview?.turn ? preview.turn === "interviewer" : callTurn.voice;
  // The meters: the call's real levels; a preview's invented voices follow its turn.
  const levels: MeterLevels | null = !live
    ? null
    : preview
      ? { interviewer: () => (voiceOn ? speechLevel(performance.now(), 0.7) : 0), candidate: () => (turn === "candidate" ? speechLevel(performance.now(), 2.3) : 0) }
      : { interviewer: interviewerLevel, candidate: candidateLevel };

  const status: RoomStatus = starting
    ? queued
      ? "queued"
      : "connecting"
    : live
      ? TURN_STATUS[turn]
      : phase.kind === "ending"
        ? "ending"
        : phase.kind === "ended"
          ? "ended"
          : earlyEnd
            ? "endedEarly"
            : dropped
              ? "dropped"
              : atCap
                ? "noStarts"
                : entry.kind === "voice-down"
                  ? "voiceDown"
                  : blocked
                    ? "noInterviews"
                    : "ready";

  const startKey =
    phase.kind === "starting"
      ? phase.step === "microphone"
        ? "room.startButton.microphone"
        : phase.step === "session"
          ? "room.startButton.session"
          : phase.step === "queued"
            ? "room.startButton.queued"
            : "room.startButton.connecting"
      : silentDrop
        ? "room.startButton.startAgain"
        : earlyEnd
          ? "room.startButton.continue"
          : dropped
            ? "room.startButton.reconnect"
            : "room.startButton.start";

  // Start (or Reconnect, Continue) is on offer; without it the footer has no hint to give.
  const startOffered = !(atCap || blocked || (dropped && !canResume));
  const inCall = starting || live || phase.kind === "ending" || phase.kind === "ended";
  // Ending and ended both lead to the feedback; the hint about the questions is for before a call.
  const hintKey = live ? "room.hint.live" : phase.kind === "ended" || phase.kind === "ending" ? "room.hint.ended" : "room.hint.idle";

  const clock: RoomClock | null =
    blocked && phase.kind === "idle" ? null : { label: live ? "timeLeft" : "length", text: timeUp ? t("room.clock.closing") : formatClock(remaining), closing: timeUp };

  const facts: RoomFacts | null =
    phase.kind === "idle" && !atCap && !blocked ? { minutes: Math.round(maxSeconds / 60), source: sourceLine, language, onLanguage: setLanguage } : null;

  const roomNotice: RoomNotice | null = notice
    ? { text: notice, tone: "problem" }
    : timeUp || sayingGoodbye
      ? { text: t(timeUp ? "room.countdown.closing" : "room.countdown.goodbye"), tone: "strong" }
      : clockNoticeKey
        ? { text: t(clockNoticeKey), tone: "strong" }
        : queued
          ? { text: t("room.queue.short"), tone: "strong" }
          : canResume
            ? { text: t(earlyEnd ? "room.continueStarts" : "room.reconnect", { count: startsLeft }), tone: "strong" }
            : startOffered || live || phase.kind === "ended"
              ? { text: t(hintKey), tone: "hint" }
              : null;

  const showOffer = blocked && !atCap && (phase.kind === "idle" || (dropped && entry.kind === "voice-down"));
  const panelParts = [
    lengthChanged && (
      <PanelLine key="length" role="note" className="text-ink-2">
        {t("room.lengthChanged", { count: Math.round(maxSeconds / 60), promised: Math.round(maxDurationSeconds / 60) })}
      </PanelLine>
    ),
    phase.kind === "idle" && atCap && (
      <div key="cap">
        <PanelLine className="text-ink-2">{errorCopy("INTERVIEW_START_LIMIT")}</PanelLine>
        <Link href={`/resume/analysis/${analysisId}`} className={cn(textLinkClass, "mt-2 gap-2 text-ink underline decoration-ink-3 underline-offset-4")}>
          {t("room.backToAnalysis")}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    ),
    showOffer && <RoomOffer key="offer" entry={entry} facts={offer} preview={preview?.purchase} />,
    queued && (
      <PanelLine key="queue" role="note" className="text-ink-2">
        {t("room.queue.waiting")}
      </PanelLine>
    ),
    silentDrop && (
      <PanelLine key="silent" role="note">
        {t("room.dropped.silent", { count: Math.round(leftAfterDrop / 60) })}
      </PanelLine>
    ),
    dropped && !silentDrop && (
      <div key="dropped">
        <PanelLine>
          {earlyEnd
            ? t("room.dropped.early", { left: formatClock(leftAfterDrop) })
            : t("room.dropped.at", { at: formatClock(usedBefore), left: formatClock(leftAfterDrop) })}
        </PanelLine>
        <PanelSub>
          {canResume
            ? t(earlyEnd ? "room.dropped.earlyResume" : "room.dropped.resume")
            : startsLeft === 0
              ? t("room.dropped.noStarts")
              : t("room.dropped.noTime")}
        </PanelSub>
        <RoomButton tone="quiet" icon="next" busy={finishing} onClick={handleFinish} disabled={finishing || starting} className="mt-5">
          {t("room.dropped.finish")}
        </RoomButton>
      </div>
    ),
  ].filter(Boolean);

  const action = live ? (
    <RoomButton tone="danger" icon="end" onClick={handleEnd}>
      {t("room.end")}
    </RoomButton>
  ) : phase.kind === "ending" || phase.kind === "ended" ? (
    <RoomButton busy disabled>
      {phase.kind === "ending" ? t("room.ending") : t("room.openingFeedback")}
    </RoomButton>
  ) : !startOffered ? null : (
    <RoomButton icon={dropped ? "again" : "call"} busy={starting} onClick={handleStart} disabled={starting || finishing}>
      {t(startKey)}
    </RoomButton>
  );

  return (
    <RoomView
      variant="page"
      inCall={inCall}
      attempt={attemptNumber}
      role={role}
      company={company}
      status={status}
      turn={live ? turn : null}
      meter={inCall || startOffered ? { candidate: candidateName ?? t("room.you"), levels } : null}
      clock={clock}
      facts={facts}
      panel={panelParts.length > 0 ? <div className="grid gap-5">{panelParts}</div> : null}
      lines={lines}
      notice={roomNotice}
      action={action}
    />
  );
}
