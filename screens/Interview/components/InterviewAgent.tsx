"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Mic, MonitorUp, Phone, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import VoiceOrb, { type VoiceOrbState } from "@/components/voice/VoiceOrb";
import { interviewer } from "@/lib/ai/prompts/interviewer.prompt";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import { MAX_TRANSCRIPT_MESSAGES } from "@/lib/schemas/interviewSchema";
import { uploadFileToSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapiSdk";
import { submitInterviewFeedbackAction } from "@/screens/Interview/actions/submitInterviewFeedbackAction";
import Transcript, { type TranscriptMessage } from "./Transcript";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

type InterviewAgentProps = {
  interviewId: string;
  role: string;
  jobDescription: string;
  userName: string;
  userProfilePic: string;
};

const BRIEFING = [
  {
    icon: Mic,
    text: "Your microphone, so the interviewer can hear you.",
  },
  {
    icon: MonitorUp,
    text: "Sharing this tab, so the session is recorded for you to review.",
  },
];

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function InterviewAgent({
  userName,
  interviewId,
  role,
  jobDescription,
  userProfilePic,
}: InterviewAgentProps) {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);
  const [feedbackReady, setFeedbackReady] = useState(false);

  // Audio context for mixing the interviewer's voice into the recording
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const connectedAudioTracksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const onCallStart = () => setCallStatus(CallStatus.ACTIVE);
    const onCallEnd = () => {
      setCallStatus(CallStatus.FINISHED);
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onMessage = (message: any) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        const newMessage = { role: message.role, content: message.transcript };
        setMessages((prev) => [...prev, newMessage]);
      }
    };

    const onSpeechStart = () => setIsSpeaking(true);
    const onSpeechEnd = () => setIsSpeaking(false);
    const onError = (error: Error) => console.error("Error:", error);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onParticipantUpdated = (participant: any) => {
      if (participant.local) return;
      const audioTrack =
        participant.tracks?.audio?.persistentTrack ||
        participant.tracks?.audio?.track;
      if (!audioTrack || !audioContextRef.current || !audioDestinationRef.current) return;
      if (connectedAudioTracksRef.current.has(audioTrack.id)) return;

      connectedAudioTracksRef.current.add(audioTrack.id);
      try {
        const source = audioContextRef.current.createMediaStreamSource(
          new MediaStream([audioTrack]),
        );
        source.connect(audioDestinationRef.current);
      } catch (e) {
        console.error("Error connecting remote audio track:", e);
      }
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);
    vapi.on("daily-participant-updated", onParticipantUpdated);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
      vapi.off("daily-participant-updated", onParticipantUpdated);
    };
  }, []);

  // Call clock
  useEffect(() => {
    if (callStatus !== CallStatus.ACTIVE) return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [callStatus]);

  const startRecording = async () => {
    try {
      recordedChunksRef.current = [];
      setRecordedVideoUrl(null);

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
        // @ts-expect-error Chromium-only hint, harmless elsewhere.
        preferCurrentTab: true,
      });

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const destination = audioContext.createMediaStreamDestination();
      audioDestinationRef.current = destination;

      if (micStream.getAudioTracks().length > 0) {
        const micAudioSource = audioContext.createMediaStreamSource(micStream);
        micAudioSource.connect(destination);
      }

      const tracks: MediaStreamTrack[] = [
        displayStream.getVideoTracks()[0],
        destination.stream.getAudioTracks()[0],
      ];

      const mixedStream = new MediaStream(tracks);

      const mediaRecorder = new MediaRecorder(mixedStream, {
        mimeType: "video/webm",
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: "video/webm",
        });
        setRecordedVideoUrl(URL.createObjectURL(blob));

        displayStream.getTracks().forEach((track) => track.stop());
        micStream.getTracks().forEach((track) => track.stop());
        if (audioContext.state !== "closed") {
          audioContext.close();
        }
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      return true;
    } catch (err) {
      console.error("Error starting recording:", err);
      return false;
    }
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  const handleGenerateFeedback = async (messagesToSave: TranscriptMessage[]) => {
    setIsGeneratingFeedback(true);
    let uploadedVideoUrl: string | undefined = undefined;

    if (recordedChunksRef.current.length > 0) {
      try {
        const file = new File(
          recordedChunksRef.current,
          `interview-${interviewId}-${Date.now()}.webm`,
          { type: "video/webm" },
        );
        uploadedVideoUrl = await uploadFileToSupabase(file, file.name);
      } catch (error) {
        console.error("Error uploading recording:", error);
      }
    }

    try {
      const result = await submitInterviewFeedbackAction({
        interviewId,
        // The server caps the transcript; send the last turns so a long
        // interview isn't rejected outright.
        transcript: messagesToSave.slice(-MAX_TRANSCRIPT_MESSAGES),
        recordingUrl: uploadedVideoUrl,
      });

      if (!result.ok) {
        toast.error(actionErrorCopy(result.code));
        return;
      }
      setFeedbackReady(true);
    } catch {
      toast.error(actionErrorCopy("UNKNOWN"));
    } finally {
      // In finally so a failure can't leave the button spinning forever.
      setIsGeneratingFeedback(false);
    }
  };

  useEffect(() => {
    if (callStatus === CallStatus.FINISHED) {
      handleGenerateFeedback(messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callStatus]);

  const handleCall = async () => {
    setPermissionError(null);
    setCallStatus(CallStatus.CONNECTING);

    const recordingStarted = await startRecording();
    if (!recordingStarted) {
      setPermissionError(
        "The interview can't start without your microphone and this tab being shared. Allow both and try again.",
      );
      setCallStatus(CallStatus.INACTIVE);
      return;
    }

    try {
      await vapi.start(interviewer, {
        variableValues: {
          jobdescription: jobDescription,
        },
      });
    } catch (error) {
      console.error("Failed to start VAPI:", error);
      stopRecording();
      setCallStatus(CallStatus.INACTIVE);
      toast.error("The interviewer couldn't connect. Try again in a moment.");
    }
  };

  const handleDisconnect = () => {
    setCallStatus(CallStatus.FINISHED);
    vapi.stop();
    stopRecording();
  };

  const active = callStatus === CallStatus.ACTIVE;
  const finished = callStatus === CallStatus.FINISHED;
  const connecting = callStatus === CallStatus.CONNECTING;

  const orbState: VoiceOrbState = finished
    ? "ended"
    : connecting
      ? "connecting"
      : active
        ? isSpeaking
          ? "speaking"
          : "listening"
        : "idle";

  const statusLine = finished
    ? "Interview ended"
    : connecting
      ? "Connecting"
      : active
        ? isSpeaking
          ? "Interviewer is speaking"
          : "Listening to you"
        : "Ready when you are";

  return (
    <div className="flex flex-1 flex-col">
      <div className="wrap flex flex-1 flex-col py-8 lg:py-10">
        {/* Room header */}
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
          <div>
            <Eyebrow tick>Interview room</Eyebrow>
            <h1 className="display-md mt-3">{role}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                active ? "glow-signal bg-signal animate-blink" : finished ? "bg-ink-3" : "bg-line-strong",
              )}
            />
            <span className="eyebrow text-ink">{statusLine}</span>
            <span className="eyebrow tabular border-l border-line pl-4">
              {formatDuration(elapsed)}
            </span>
          </div>
        </header>

        <div className="grid flex-1 gap-12 py-10 lg:grid-cols-12 lg:gap-16">
          {/* Stage */}
          <section
            aria-label="Interviewer"
            className="flex flex-col items-center lg:col-span-5"
          >
            <VoiceOrb state={orbState} className="w-56 sm:w-64 lg:w-72" />

            <div className="mt-10 flex items-center gap-5">
              <div className="relative size-12 overflow-hidden rounded-full border border-line-strong">
                <Image
                  src={userProfilePic}
                  alt=""
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              </div>
              <div>
                <p className="font-medium">{userName}</p>
                <p className="eyebrow mt-1">Candidate</p>
              </div>
            </div>

            {!active && !finished && (
              <div className="mt-12 w-full max-w-sm">
                <p className="eyebrow">Before we start, the browser will ask for</p>
                <ul className="mt-4 space-y-3">
                  {BRIEFING.map((item) => (
                    <li key={item.text} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                      <item.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink" />
                      {item.text}
                    </li>
                  ))}
                </ul>
                <p className="eyebrow mt-5">Expect ten to fifteen minutes.</p>
              </div>
            )}

            {finished && recordedVideoUrl && (
              <figure className="mt-12 w-full max-w-sm">
                <figcaption className="eyebrow mb-3">Your recording</figcaption>
                <video
                  src={recordedVideoUrl}
                  controls
                  className="w-full border border-line bg-studio"
                />
              </figure>
            )}
          </section>

          {/* Transcript */}
          <Transcript
            messages={messages}
            userName={userName}
            live={active}
            className="max-h-[60dvh] lg:col-span-7 lg:max-h-none"
          />
        </div>

        {/* Controls */}
        <footer className="sticky bottom-0 -mx-[clamp(1.25rem,4vw,3rem)] mt-auto border-t border-line bg-paper/90 px-[clamp(1.25rem,4vw,3rem)] py-4 backdrop-blur-[6px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div role="status" aria-live="polite" className="min-h-5 text-sm">
              {permissionError ? (
                <p className="flex items-center gap-2 text-signal">
                  <span aria-hidden className="size-1.5 shrink-0 bg-signal" />
                  {permissionError}
                </p>
              ) : finished ? (
                <p className="text-ink-2">
                  {isGeneratingFeedback
                    ? "Scoring the interview. This takes a minute."
                    : feedbackReady
                      ? "Your feedback is ready."
                      : "The interview ended."}
                </p>
              ) : (
                <p className="text-ink-2">
                  {active
                    ? "Speak naturally. Hang up whenever you're done."
                    : "Questions are built from the job post you analyzed."}
                </p>
              )}
            </div>

            {active ? (
              <Button
                variant="destructive"
                size="lg"
                onClick={handleDisconnect}
                className="h-12 gap-2 px-6 text-base"
              >
                <PhoneOff className="size-5" />
                End interview
              </Button>
            ) : finished ? (
              <Button
                size="lg"
                disabled={isGeneratingFeedback || !feedbackReady}
                onClick={() => router.push(`/interview/${interviewId}/feedback`)}
                className="group h-12 gap-2 px-6 text-base"
              >
                {isGeneratingFeedback ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    Generating feedback
                  </>
                ) : (
                  <>
                    Read your feedback
                    <ArrowRight className="size-5 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={handleCall}
                disabled={connecting}
                className="h-12 gap-2 px-6 text-base"
              >
                {connecting ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    Connecting
                  </>
                ) : (
                  <>
                    <Phone className="size-5" />
                    Start the interview
                  </>
                )}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
