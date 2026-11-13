"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Phone, PhoneOff, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import VoiceOrb, { type VoiceOrbState } from "@/components/voice/VoiceOrb";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { INTERVIEW_LANGUAGES, type InterviewLanguage } from "@/lib/ai/postingLanguage";
import type { RoomEntry } from "@/lib/interviewEntry";
import type { InterviewSessionResponse } from "@/lib/schemas/interviewSessionSchema";
import { cn } from "@/lib/utils";
import {
  countdownNoticeKey,
  countdownPhase,
  formatClock,
  remainingSeconds,
} from "../utils/countdown";
import { reportInterviewEnded, requestInterviewSession } from "../utils/session";
import { isEarlyEnd, type RoomEndClaim } from "@/lib/voice/callEnd";
import { dueTimeNote, type TimeNoteId } from "@/lib/voice/timeNotes";
import { useVoiceCall, VoiceCallProvider } from "./elevenlabs/VoiceCall";
import RoomOffer, { type RoomOfferFacts } from "./RoomOffer";
import Transcript, { type TranscriptLine } from "./Transcript";

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
  /** Dev-only layout harness (/dev/room-preview): opens live with these lines, never calls the platform or the server. */
  preview?: { lines: TranscriptLine[]; later?: TranscriptLine[]; everyMs?: number };
};

type BlockedEntry = Extract<RoomEntry, { kind: "needs-pro" | "needs-pack" | "voice-down" }>;
const isBlocked = (entry: RoomEntry): entry is BlockedEntry => entry.kind === "needs-pro" || entry.kind === "needs-pack" || entry.kind === "voice-down";

/**
 * The interview room. The browser never holds a key: Start asks the server
 * for a session, and the server answers with a single-use conversation token
 * and the variables it issued, which go to the SDK untouched. What the
 * candidate says is transcribed by the platform and delivered to the server
 * by webhook; the transcript shown here is for the candidate's eyes and is
 * never sent anywhere.
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
  // early: the interviewer hung up before the wrap-up line; the time left is still the candidate's.
  | { kind: "dropped"; silent?: boolean; early?: boolean };

/** Why the microphone could not be opened; each has its copy under room.microphone. */
type MicProblem = "insecure" | "denied" | "missing" | "failed";

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

/** A resumed call is shorter than the platform's limit: past its length by this much, the room hangs up. */
const OVERTIME_SECONDS = 3;
/** A first call ends at the platform's own limit, with its spoken line: the room only steps in well after it. */
const PLATFORM_LIMIT_GRACE_SECONDS = 15;
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
}: InterviewAgentProps) {
  const router = useRouter();
  const { t } = useTranslation("interview");
  const errorCopy = useErrorCopy();
  const [phase, setPhase] = useState<Phase>(preview ? { kind: "live" } : resume ? { kind: "dropped", early: resume.early === true } : { kind: "idle" });
  const [language, setLanguage] = useState<InterviewLanguage>(proposedLanguage);
  // Seconds of the interview used by earlier calls; the clock after a drop starts from what is left.
  const [usedBefore, setUsedBefore] = useState(resume?.usedSeconds ?? 0);
  const [finishing, setFinishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [startsUsed, setStartsUsed] = useState(startCount);
  const [session, setSession] = useState<InterviewSessionResponse | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(() => (preview ? Date.now() : null));
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
  // Who hangs up when the room does: the candidate's End, or the room's own clock.
  const endingBy = useRef<"user" | "room">("user");

  const endFallback = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (endFallback.current !== null) window.clearTimeout(endFallback.current);
    };
  }, []);

  const feedbackHref = `/interview/${interviewId}/feedback?ended=1`;

  const goToFeedback = useCallback(() => {
    setPhase({ kind: "ended" });
    router.push(feedbackHref);
  }, [router, feedbackHref]);

  const failStart = useCallback((copy: string) => {
    setNotice(copy);
    setPhase({ kind: "idle" });
  }, []);

  const { start: startCall, end: endCall, notify, mode } = useVoiceCall({
    onConnect: () => {
      notesSent.current = new Set();
      setConnectedAt(Date.now());
      setNow(Date.now());
      setNotice(null);
      setPhase({ kind: "live" });
    },
    onEnd: (end) => {
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
      const early =
        current === "live" &&
        end.reason === "agent" &&
        spoke.current &&
        isEarlyEnd({ endedBy: "agent", secondsLeft: callSeconds - elapsed, finishRequested: false, turns: linesRef.current.map((line) => ({ role: line.role, message: line.text })) });
      const dropped = early || (!neverBegan && !finished && !end.finished);
      const claim: RoomEndClaim =
        current === "ending" ? endingBy.current : end.reason === "user" ? "user" : end.reason === "agent" ? "interviewer" : end.limit ? "limit" : "disconnect";

      // The server learns now that the call is over, why the room thinks so and how long it ran. Not awaited.
      void reportInterviewEnded(interviewId, end.reason, fetch, finished ? "finish" : dropped ? "drop" : undefined, { end: claim, elapsedSeconds: Math.round(elapsedExact * 10) / 10 });

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
    },
    onError: (message) => {
      // The SDK's own message: about the session, never about the candidate.
      console.error("[CVision][room] voice session error:", message);
      if (phaseRef.current.kind === "starting") failStart(errorCopy("VOICE_UNAVAILABLE"));
    },
    onLine: ({ role: speaker, text }) => {
      if (!text.trim()) return;
      if (speaker === "user") spoke.current = true;
      setLines((prev) => [...prev, { role: speaker, text }]);
    },
    // An interrupted agent line is reported as what was planned, then
    // corrected to what was actually said.
    onLineCorrected: ({ original, corrected }) => {
      setLines((prev) => {
        const index = prev.findLastIndex((line) => line.role === "agent" && line.text === original);
        if (index < 0) return prev;
        const next = prev.slice();
        next[index] = { role: "agent", text: corrected };
        return next;
      });
    },
  });

  const handleStart = async () => {
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

  const handleEnd = () => {
    endingBy.current = "user";
    setPhase({ kind: "ending" });
    endCall();
    endFallback.current = window.setTimeout(() => {
      if (phaseRef.current.kind === "ending") goToFeedback();
    }, END_FALLBACK_MS);
  };

  // After a drop: close the interview with what was said, and go to its feedback.
  const handleFinish = async () => {
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
  const clockPhase = live ? countdownPhase(remaining) : "normal";
  // The warnings follow the interface language, not the language the session speaks.
  const clockNoticeKey = live ? countdownNoticeKey(clockPhase) : null;

  const speaking = live && mode === "speaking";
  const queued = phase.kind === "starting" && phase.step === "queued";

  useEffect(() => {
    callRef.current = { connectedAt, callSeconds };
  }, [connectedAt, callSeconds]);

  // The interviewer has no clock: the room tells it once when a minute is
  // left, and hangs up itself when a call runs past its length.
  const elapsedLive = live && connectedAt !== null ? Math.floor((now - connectedAt) / 1000) : 0;
  useEffect(() => {
    if (!live || preview) return;
    const note = dueTimeNote(callSeconds, elapsedLive, notesSent.current);
    if (note) {
      notesSent.current.add(note.id);
      notify(note.text);
    }
    // The platform enforces a first call's length itself; the room enforces what is left of a resumed one.
    if (elapsedLive >= callSeconds + (session?.resumed ? OVERTIME_SECONDS : PLATFORM_LIMIT_GRACE_SECONDS)) {
      endingBy.current = "room";
      setPhase({ kind: "ending" });
      endCall();
    }
  }, [live, preview, elapsedLive, callSeconds, notify, endCall, session?.resumed]);

  const orbState: VoiceOrbState =
    phase.kind === "ending" || phase.kind === "ended"
      ? "ended"
      : starting
        ? "connecting"
        : live
          ? speaking
            ? "speaking"
            : "listening"
          : "idle";

  const statusKey =
    phase.kind === "starting"
      ? queued
        ? "room.status.queued"
        : "room.status.connecting"
      : phase.kind === "live"
        ? speaking
          ? "room.status.speaking"
          : "room.status.yourTurn"
        : phase.kind === "ending"
          ? "room.status.ending"
          : phase.kind === "ended"
            ? "room.status.ended"
            : dropped
              ? "room.status.dropped"
              : atCap
                ? "room.status.noStarts"
                : entry.kind === "voice-down"
                  ? "room.status.voiceDown"
                  : blocked
                    ? "room.status.noInterviews"
                    : "room.status.ready";

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
  const hintKey = live ? "room.hint.live" : phase.kind === "ended" ? "room.hint.ended" : "room.hint.idle";

  return (
    // Desktop: the viewport under the header (h-16 + border), so the transcript ends above the controls.
    <div className="flex flex-1 flex-col lg:h-[calc(100dvh-4rem-1px)] lg:flex-none">
      <div className="wrap flex min-h-0 flex-1 flex-col py-8 lg:py-6">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
          <div>
            <Eyebrow tick>{t("room.eyebrow", { attempt: attemptNumber })}</Eyebrow>
            <h1 className="display-md mt-3">{role}</h1>
            <p className="mt-2 text-ink-2">{company}</p>
          </div>
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                live
                  ? "glow-signal bg-signal animate-blink"
                  : phase.kind === "ended" || dropped
                    ? "bg-ink-3"
                    : "bg-line-strong",
              )}
            />
            <span className="eyebrow text-ink">{t(statusKey)}</span>
            {!(blocked && phase.kind === "idle") && <span
              className={cn(
                "eyebrow tabular border-l border-line pl-4",
                clockPhase === "final" && "text-signal",
                clockPhase === "warning" && "text-ink",
              )}
              aria-label={live ? t("room.clock.timeLeft") : t("room.clock.length")}
            >
              {formatClock(remaining)}
            </span>}
          </div>
        </header>

        <div className="grid flex-1 gap-12 py-10 lg:min-h-0 lg:grid-cols-12 lg:gap-16 lg:py-8">
          <section aria-label={t("room.interviewer")} className="flex flex-col items-center lg:col-span-5 lg:min-h-0 lg:overflow-y-auto lg:px-2">
            <VoiceOrb state={orbState} className="w-56 sm:w-64 lg:w-72 lg:[@media(max-height:820px)]:w-48" />

            <div className="mt-10 text-center">
              <p className="font-medium">{candidateName ?? t("room.you")}</p>
              <p className="eyebrow mt-1">{t("room.candidate")}</p>
            </div>

            {phase.kind === "idle" && !atCap && !blocked && (
              <dl className="mt-12 w-full max-w-sm text-sm">
                <div>
                  <dt className="eyebrow">{t("room.length")}</dt>
                  <dd className="mt-1 text-ink">{t("room.upTo", { count: Math.round(maxSeconds / 60) })}</dd>
                  {sourceLine && <dd className="mt-1 text-ink-2">{sourceLine}</dd>}
                </div>
                <div className="mt-6">
                  <dt className="eyebrow">
                    <label htmlFor="interview-language">{t("room.language.label")}</label>
                  </dt>
                  <dd className="mt-1">
                    <select
                      id="interview-language"
                      value={language}
                      onChange={(event) => setLanguage(event.target.value as InterviewLanguage)}
                      className="h-10 w-full border-b border-line-strong bg-transparent text-ink focus-visible:border-ink focus-visible:outline-none"
                    >
                      {INTERVIEW_LANGUAGES.map((code) => (
                        <option key={code} value={code}>
                          {t(`room.language.${code}`)}
                        </option>
                      ))}
                    </select>
                  </dd>
                  <dd className="mt-2 text-ink-2">{t("room.language.note")}</dd>
                </div>
              </dl>
            )}

            {lengthChanged && (
              <p role="note" className="mt-6 w-full max-w-sm text-sm leading-relaxed text-ink-2">
                {t("room.lengthChanged", {
                  count: Math.round(maxSeconds / 60),
                  promised: Math.round(maxDurationSeconds / 60),
                })}
              </p>
            )}

            {phase.kind === "idle" && atCap && (
              <div className="mt-12 w-full max-w-sm">
                <p className="text-sm leading-relaxed text-ink-2">
                  {errorCopy("INTERVIEW_START_LIMIT")}
                </p>
                <Link
                  href={`/resume/analysis/${analysisId}`}
                  className="link-rule mt-4 inline-flex items-center gap-2 text-sm font-medium text-ink"
                >
                  {t("room.backToAnalysis")}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            )}

            {blocked && !atCap && (phase.kind === "idle" || (dropped && entry.kind === "voice-down")) && <RoomOffer entry={entry} facts={offer} />}

            {queued && (
              <p role="note" className="mt-12 w-full max-w-sm text-sm leading-relaxed text-ink-2">
                {t("room.queue.waiting")}
              </p>
            )}

            {silentDrop && (
              <p role="note" className="mt-12 w-full max-w-sm text-sm leading-relaxed text-ink">
                {t("room.dropped.silent", { count: Math.round(leftAfterDrop / 60) })}
              </p>
            )}

            {dropped && !silentDrop && (
              <div className="mt-12 w-full max-w-sm">
                <p className="text-sm leading-relaxed text-ink">
                  {earlyEnd
                    ? t("room.dropped.early", { left: formatClock(leftAfterDrop) })
                    : t("room.dropped.at", { at: formatClock(usedBefore), left: formatClock(leftAfterDrop) })}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  {canResume
                    ? t(earlyEnd ? "room.dropped.earlyResume" : "room.dropped.resume")
                    : startsLeft === 0
                      ? t("room.dropped.noStarts")
                      : t("room.dropped.noTime")}
                </p>
                <Button
                  variant="outline"
                  onClick={handleFinish}
                  disabled={finishing || starting}
                  className="mt-5 h-11 gap-2 px-5"
                >
                  {finishing ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  {t("room.dropped.finish")}
                </Button>
              </div>
            )}
          </section>

          <Transcript
            lines={lines}
            live={live}
            className="h-[clamp(14rem,calc(100dvh-16rem),26rem)] lg:col-span-7 lg:h-full lg:min-h-0"
          />
        </div>

        <footer className="sticky bottom-0 -mx-[clamp(1.25rem,4vw,3rem)] mt-auto border-t border-line bg-paper/90 px-[clamp(1.25rem,4vw,3rem)] py-4 backdrop-blur-[6px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div role="status" aria-live="polite" className="min-h-5 text-sm">
              {notice ? (
                <p className="flex items-center gap-2 text-signal">
                  <span aria-hidden className="size-1.5 shrink-0 bg-signal" />
                  {notice}
                </p>
              ) : clockNoticeKey ? (
                <p className={cn("font-medium", clockPhase === "final" ? "text-signal" : "text-ink")}>
                  {t(clockNoticeKey)}
                </p>
              ) : queued ? (
                <p className="font-medium text-ink">{t("room.queue.short")}</p>
              ) : canResume ? (
                <p className="font-medium text-ink">{t(earlyEnd ? "room.continueStarts" : "room.reconnect", { count: startsLeft })}</p>
              ) : startOffered || live || phase.kind === "ended" ? (
                <p className="text-ink-2">{t(hintKey)}</p>
              ) : null}
            </div>

            {live ? (
              <Button
                variant="destructive"
                size="lg"
                onClick={handleEnd}
                className="h-12 gap-2 px-6 text-base"
              >
                <PhoneOff className="size-5" />
                {t("room.end")}
              </Button>
            ) : phase.kind === "ending" || phase.kind === "ended" ? (
              <Button size="lg" disabled className="h-12 gap-2 px-6 text-base">
                <Loader2 className="size-5 animate-spin" />
                {phase.kind === "ending" ? t("room.ending") : t("room.openingFeedback")}
              </Button>
            ) : !startOffered ? null : (
              <Button
                size="lg"
                onClick={handleStart}
                disabled={starting || finishing}
                className="h-12 gap-2 px-6 text-base"
              >
                {starting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : dropped ? (
                  <RotateCcw className="size-5" />
                ) : (
                  <Phone className="size-5" />
                )}
                {t(startKey)}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
