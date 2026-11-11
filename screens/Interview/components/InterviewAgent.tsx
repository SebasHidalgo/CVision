"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { ArrowRight, Loader2, Phone, PhoneOff, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import VoiceOrb, { type VoiceOrbState } from "@/components/voice/VoiceOrb";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { WORKLET_PATHS } from "@/lib/elevenlabs/worklets";
import type { EntitlementSource } from "@/lib/interviewEntitlement";
import type { InterviewSessionResponse } from "@/lib/schemas/interviewSessionSchema";
import { cn } from "@/lib/utils";
import {
  countdownNoticeKey,
  countdownPhase,
  formatClock,
  remainingSeconds,
} from "../utils/countdown";
import { reportInterviewEnded, requestInterviewSession } from "../utils/session";
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
  /** What pays for the next start (or paid for this interview), from the entitlement; "none" when nothing can. */
  source: EntitlementSource | null;
};

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
    <ConversationProvider>
      <InterviewRoom {...props} />
    </ConversationProvider>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "starting"; step: "microphone" | "session" | "connecting" }
  | { kind: "live" }
  | { kind: "ending" }
  | { kind: "ended" }
  | { kind: "dropped" };

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

/** The SDK always reaches onDisconnect after endSession; this is the belt for a hook that never fires. */
const END_FALLBACK_MS = 5_000;

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
  source,
}: InterviewAgentProps) {
  const router = useRouter();
  const { t } = useTranslation("interview");
  const errorCopy = useErrorCopy();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [startsUsed, setStartsUsed] = useState(startCount);
  const [session, setSession] = useState<InterviewSessionResponse | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lines, setLines] = useState<TranscriptLine[]>([]);

  // The SDK's callbacks fire outside React's render; they read the phase
  // through a ref so a callback registered on an earlier render sees the
  // current one.
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

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

  const { startSession, endSession, mode } = useConversation({
    onConnect: () => {
      setConnectedAt(Date.now());
      setNow(Date.now());
      setNotice(null);
      setPhase({ kind: "live" });
    },
    onDisconnect: (details) => {
      const current = phaseRef.current.kind;
      if (current === "ended") return;

      // Whatever ended it, the server learns the call is over now rather
      // than when the transcript lands. Not awaited: nothing here depends on it.
      void reportInterviewEnded(interviewId, details.reason);

      // The platform's hard limit arrives as an error event; it is the agent
      // ending the call, not a failure.
      const endedByCall =
        details.reason === "user" ||
        details.reason === "agent" ||
        (details.reason === "error" && details.context.type === "max_duration_exceeded");

      if (current === "ending" || endedByCall) {
        goToFeedback();
        return;
      }
      if (current === "starting") {
        failStart(errorCopy("VOICE_UNAVAILABLE"));
        return;
      }
      setPhase({ kind: "dropped" });
    },
    onError: (message) => {
      // The SDK's own message: about the session, never about the candidate.
      console.error("[CVision][room] voice session error:", message);
      if (phaseRef.current.kind === "starting") failStart(errorCopy("VOICE_UNAVAILABLE"));
    },
    onMessage: ({ role: speaker, message }) => {
      if (!message.trim()) return;
      setLines((prev) => [...prev, { role: speaker, text: message }]);
    },
    // An interrupted agent line is reported as what was planned, then
    // corrected to what was actually said.
    onAgentResponseCorrection: ({ original_agent_response, corrected_agent_response }) => {
      setLines((prev) => {
        const index = prev.findLastIndex(
          (line) => line.role === "agent" && line.text === original_agent_response,
        );
        if (index < 0) return prev;
        const next = prev.slice();
        next[index] = { role: "agent", text: corrected_agent_response };
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
    const result = await requestInterviewSession(interviewId);
    if (!result.ok) {
      if (result.code === "INTERVIEW_START_LIMIT") setStartsUsed(maxStarts);
      failStart(errorCopy(result.code));
      return;
    }

    // The server recorded the start when it answered; from here on it counts.
    setStartsUsed((used) => used + 1);
    setSession(result.data);
    setPhase({ kind: "starting", step: "connecting" });
    startSession({
      connectionType: "webrtc",
      conversationToken: result.data.conversationToken,
      dynamicVariables: result.data.dynamicVariables,
      overrides: { agent: { language: result.data.language } },
      // The SDK's audio worklets from this origin, not from blob: URLs the
      // Content-Security-Policy refuses.
      workletPaths: WORKLET_PATHS,
    });
  };

  const handleEnd = () => {
    setPhase({ kind: "ending" });
    endSession();
    endFallback.current = window.setTimeout(() => {
      if (phaseRef.current.kind === "ending") goToFeedback();
    }, END_FALLBACK_MS);
  };

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

  // Before Start the length comes from the entitlement the page read; after
  // it, from the session the server issued. They differ only when the facts
  // changed in between (a credit spent in another tab): the session wins,
  // and the room says so rather than jumping silently.
  const maxSeconds = session?.maxDurationSeconds ?? maxDurationSeconds;
  const shownSource = session?.source ?? source;
  const sourceKey = shownSource && shownSource !== "none" ? (`room.source.${shownSource}` as const) : null;
  const lengthChanged = session !== null && maxDurationSeconds > 0 && session.maxDurationSeconds !== maxDurationSeconds;
  const remaining =
    live && connectedAt !== null ? remainingSeconds(maxSeconds, connectedAt, now) : maxSeconds;
  const clockPhase = live ? countdownPhase(remaining) : "normal";
  // The warnings follow the interface language, not the language the session speaks.
  const clockNoticeKey = live ? countdownNoticeKey(clockPhase) : null;

  const speaking = live && mode === "speaking";

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
      ? "room.status.connecting"
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
                : "room.status.ready";

  const startKey =
    phase.kind === "starting"
      ? phase.step === "microphone"
        ? "room.startButton.microphone"
        : phase.step === "session"
          ? "room.startButton.session"
          : "room.startButton.connecting"
      : dropped
        ? "room.startButton.retry"
        : "room.startButton.start";

  const hintKey = live ? "room.hint.live" : phase.kind === "ended" ? "room.hint.ended" : "room.hint.idle";

  return (
    <div className="flex flex-1 flex-col">
      <div className="wrap flex flex-1 flex-col py-8 lg:py-10">
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
            <span
              className={cn(
                "eyebrow tabular border-l border-line pl-4",
                clockPhase === "final" && "text-signal",
                clockPhase === "warning" && "text-ink",
              )}
              aria-label={live ? t("room.clock.timeLeft") : t("room.clock.length")}
            >
              {formatClock(remaining)}
            </span>
          </div>
        </header>

        <div className="grid flex-1 gap-12 py-10 lg:grid-cols-12 lg:gap-16">
          <section aria-label={t("room.interviewer")} className="flex flex-col items-center lg:col-span-5">
            <VoiceOrb state={orbState} className="w-56 sm:w-64 lg:w-72" />

            <div className="mt-10 text-center">
              <p className="font-medium">{candidateName ?? t("room.you")}</p>
              <p className="eyebrow mt-1">{t("room.candidate")}</p>
            </div>

            {phase.kind === "idle" && !atCap && (
              <dl className="mt-12 w-full max-w-sm text-sm">
                <div>
                  <dt className="eyebrow">{t("room.length")}</dt>
                  <dd className="mt-1 text-ink">{t("room.upTo", { count: Math.round(maxSeconds / 60) })}</dd>
                  {sourceKey && <dd className="mt-1 text-ink-2">{t(sourceKey)}</dd>}
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

            {dropped && (
              <div className="mt-12 w-full max-w-sm">
                <p className="text-sm leading-relaxed text-ink">
                  {t("room.dropped.title")}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  {startsLeft === 0 ? t("room.dropped.noStarts") : t("room.dropped.mayScore")}
                </p>
                <Link
                  href={feedbackHref}
                  className="link-rule mt-4 inline-flex items-center gap-2 text-sm font-medium text-ink"
                >
                  {t("room.dropped.checkFeedback")}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            )}
          </section>

          <Transcript
            lines={lines}
            live={live}
            className="max-h-[60dvh] lg:col-span-7 lg:max-h-none"
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
              ) : dropped && startsLeft > 0 ? (
                <p className="font-medium text-ink">{t("room.reconnect", { count: startsLeft })}</p>
              ) : (
                <p className="text-ink-2">{t(hintKey)}</p>
              )}
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
            ) : atCap ? null : (
              <Button
                size="lg"
                onClick={handleStart}
                disabled={starting}
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
