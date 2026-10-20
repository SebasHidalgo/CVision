"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { ArrowRight, Loader2, Phone, PhoneOff, RotateCcw } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import VoiceOrb, { type VoiceOrbState } from "@/components/voice/VoiceOrb";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import type { InterviewSessionResponse } from "@/lib/schemas/interviewSessionSchema";
import { cn } from "@/lib/utils";
import {
  countdownNotice,
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

const MIC_COPY = {
  insecure:
    "The microphone only works over a secure connection. Open this page over https and try again.",
  denied:
    "Microphone access was blocked. Allow the microphone for this site in your browser's site settings (the icon next to the address bar), then try again.",
  missing:
    "No microphone was found. Connect one, or check that the browser can see it, then try again.",
  failed:
    "The microphone could not be opened. Close other apps that may be using it and try again.",
};

/**
 * Asks for the microphone before anything is paid for: a denied permission
 * costs nothing, while a session issued and never joined costs a start. The
 * SDK asks again when the session starts; by then the answer is remembered.
 */
async function requestMicrophone(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return MIC_COPY.insecure;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return null;
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return MIC_COPY.denied;
    if (name === "NotFoundError" || name === "OverconstrainedError") return MIC_COPY.missing;
    return MIC_COPY.failed;
  }
}

/** The SDK always reaches onDisconnect after endSession; this is the belt for a hook that never fires. */
const END_FALLBACK_MS = 5_000;

const startsCopy = (left: number) => `${left} ${left === 1 ? "start" : "starts"} left`;

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
}: InterviewAgentProps) {
  const router = useRouter();
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
        failStart(actionErrorCopy("VOICE_UNAVAILABLE"));
        return;
      }
      setPhase({ kind: "dropped" });
    },
    onError: (message) => {
      // The SDK's own message: about the session, never about the candidate.
      console.error("[CVision][room] voice session error:", message);
      if (phaseRef.current.kind === "starting") failStart(actionErrorCopy("VOICE_UNAVAILABLE"));
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
      failStart(micProblem);
      return;
    }

    setPhase({ kind: "starting", step: "session" });
    const result = await requestInterviewSession(interviewId);
    if (!result.ok) {
      if (result.code === "INTERVIEW_START_LIMIT") setStartsUsed(maxStarts);
      failStart(actionErrorCopy(result.code));
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

  const maxSeconds = session?.maxDurationSeconds ?? maxDurationSeconds;
  const language = session?.language ?? "en";
  const remaining =
    live && connectedAt !== null ? remainingSeconds(maxSeconds, connectedAt, now) : maxSeconds;
  const clockPhase = live ? countdownPhase(remaining) : "normal";
  const clockNotice = live ? countdownNotice(clockPhase, language) : null;

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

  const statusLine =
    phase.kind === "starting"
      ? "Connecting"
      : phase.kind === "live"
        ? speaking
          ? "Interviewer speaking"
          : "Your turn"
        : phase.kind === "ending"
          ? "Ending the interview"
          : phase.kind === "ended"
            ? "Interview ended"
            : dropped
              ? "Connection lost"
              : atCap
                ? "No starts left"
                : "Ready when you are";

  const startLabel =
    phase.kind === "starting"
      ? phase.step === "microphone"
        ? "Checking the microphone"
        : phase.step === "session"
          ? "Starting"
          : "Connecting"
      : dropped
        ? "Try again"
        : "Start the interview";

  return (
    <div className="flex flex-1 flex-col">
      <div className="wrap flex flex-1 flex-col py-8 lg:py-10">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
          <div>
            <Eyebrow tick>Interview room · Attempt {attemptNumber}</Eyebrow>
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
            <span className="eyebrow text-ink">{statusLine}</span>
            <span
              className={cn(
                "eyebrow tabular border-l border-line pl-4",
                clockPhase === "final" && "text-signal",
                clockPhase === "warning" && "text-ink",
              )}
              aria-label={live ? "Time left" : "Interview length"}
            >
              {formatClock(remaining)}
            </span>
          </div>
        </header>

        <div className="grid flex-1 gap-12 py-10 lg:grid-cols-12 lg:gap-16">
          <section aria-label="Interviewer" className="flex flex-col items-center lg:col-span-5">
            <VoiceOrb state={orbState} className="w-56 sm:w-64 lg:w-72" />

            <div className="mt-10 text-center">
              <p className="font-medium">{candidateName ?? "You"}</p>
              <p className="eyebrow mt-1">Candidate</p>
            </div>

            {phase.kind === "idle" && !atCap && (
              <dl className="mt-12 w-full max-w-sm text-sm">
                <div>
                  <dt className="eyebrow">Length</dt>
                  <dd className="mt-1 text-ink">Up to {Math.round(maxSeconds / 60)} minutes</dd>
                </div>
              </dl>
            )}

            {phase.kind === "idle" && atCap && (
              <div className="mt-12 w-full max-w-sm">
                <p className="text-sm leading-relaxed text-ink-2">
                  {actionErrorCopy("INTERVIEW_START_LIMIT")}
                </p>
                <Link
                  href={`/resume/analysis/${analysisId}`}
                  className="link-rule mt-4 inline-flex items-center gap-2 text-sm font-medium text-ink"
                >
                  Back to the analysis
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            )}

            {dropped && (
              <div className="mt-12 w-full max-w-sm">
                <p className="text-sm leading-relaxed text-ink">
                  The connection to the interviewer was lost.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  {startsLeft === 0
                    ? "There are no starts left for this interview."
                    : "If you had already answered some questions, what was said may be scored as it stands."}
                </p>
                <Link
                  href={feedbackHref}
                  className="link-rule mt-4 inline-flex items-center gap-2 text-sm font-medium text-ink"
                >
                  Check for feedback
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
              ) : clockNotice ? (
                <p className={cn("font-medium", clockPhase === "final" ? "text-signal" : "text-ink")}>
                  {clockNotice}
                </p>
              ) : dropped && startsLeft > 0 ? (
                <p className="font-medium text-ink">Reconnect — {startsCopy(startsLeft)}</p>
              ) : (
                <p className="text-ink-2">
                  {live
                    ? "Speak naturally. End the interview whenever you are done."
                    : phase.kind === "ended"
                      ? "Opening your feedback."
                      : "The questions come from the posting and your analysis."}
                </p>
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
                End the interview
              </Button>
            ) : phase.kind === "ending" || phase.kind === "ended" ? (
              <Button size="lg" disabled className="h-12 gap-2 px-6 text-base">
                <Loader2 className="size-5 animate-spin" />
                {phase.kind === "ending" ? "Ending" : "Opening your feedback"}
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
                {startLabel}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
