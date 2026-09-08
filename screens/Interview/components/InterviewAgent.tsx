"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessageSquare, Phone, PhoneOff } from "lucide-react";
import { vapi } from "@/lib/vapiSdk";
import { interviewer } from "@/lib/ai/prompts/interviewer.prompt";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createInterviewFeedback } from "@/lib/database/interview";
import { uploadFileToSupabase } from "@/lib/supabase";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

type SavedMessage = {
  role: "user" | "system" | "assistant";
  content: string;
};

type InterviewAgentProps = {
  interviewId: string;
  jobDescription: string;
  userName: string;
  userId: string;
  feedbackId?: string;
  userProfilePic: string;
};

export default function InterviewAgent({
  userName,
  interviewId,
  jobDescription,
  userId,
  feedbackId,
  userProfilePic,
}: InterviewAgentProps) {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Recording states
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);

  // Audio Context Ref for mixing remote audio
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const connectedAudioTracksRef = useRef<Set<string>>(new Set());

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

    const onMessage = (message: any) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        const newMessage = { role: message.role, content: message.transcript };
        setMessages((prev) => [...prev, newMessage]);
      }
    };

    const onSpeechStart = () => setIsSpeaking(true);
    const onSpeechEnd = () => setIsSpeaking(false);
    const onError = (error: Error) => console.error("Error:", error);

    const onParticipantUpdated = (participant: any) => {
      if (!participant.local) {
        const audioTrack = participant.tracks?.audio?.persistentTrack || participant.tracks?.audio?.track;
        if (audioTrack && audioContextRef.current && audioDestinationRef.current) {
          if (!connectedAudioTracksRef.current.has(audioTrack.id)) {
            connectedAudioTracksRef.current.add(audioTrack.id);
            try {
              const source = audioContextRef.current.createMediaStreamSource(new MediaStream([audioTrack]));
              source.connect(audioDestinationRef.current);
            } catch (e) {
              console.error("Error connecting remote audio track:", e);
            }
          }
        }
      }
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);
    
    // @ts-ignore
    vapi.on("daily-participant-updated", onParticipantUpdated);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
      
      // @ts-ignore
      vapi.off("daily-participant-updated", onParticipantUpdated);
    };
  }, []);

  const startRecording = async () => {
    try {
      recordedChunksRef.current = [];
      setRecordedVideoUrl(null);

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
        // @ts-ignore
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
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);

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

  const handleGenerateFeedback = async (messagesToSave: SavedMessage[]) => {
    setIsGeneratingFeedback(true);
    let uploadedVideoUrl = undefined;

    if (recordedChunksRef.current.length > 0) {
      try {
        const file = new File(
          recordedChunksRef.current,
          `interview-${interviewId}-${Date.now()}.webm`,
          { type: "video/webm" }
        );
        uploadedVideoUrl = await uploadFileToSupabase(file, file.name);
      } catch (error) {
        console.error("Error uploading recording:", error);
      }
    }

    const feedback = await createInterviewFeedback({
      interviewId: interviewId!,
      userId: userId!,
      transcript: messagesToSave,
      feedbackId,
      recordingUrl: uploadedVideoUrl,
    });
    setIsGeneratingFeedback(false);

    if (!feedback) {
      console.log("Error generating feedback");
      return;
    }
  };

  useEffect(() => {
    if (callStatus === CallStatus.FINISHED) {
      handleGenerateFeedback(messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callStatus]);

  const handleCall = async () => {
    setCallStatus(CallStatus.CONNECTING);
    const recordingStarted = await startRecording();
    if (!recordingStarted) {
      alert(
        "Please allow screen and microphone recording to start the interview.",
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
    }
  };

  const handleDisconnect = () => {
    setCallStatus(CallStatus.FINISHED);
    vapi.stop();
    stopRecording();
  };

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-8rem)]">
        {/* Left Column: Interview Controls */}
        <section className="lg:col-span-1 flex flex-col gap-6">
          {/* AI Interviewer Card */}
          <Card className="bg-card/60 backdrop-blur-sm border-border/40">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                AI Interviewer
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <div className="relative w-32 h-32">
                <Image
                  src="/images/ai-icon.png"
                  alt="AI Interviewer"
                  fill
                  className="rounded-full object-cover border-2 border-border/30"
                />
                {isSpeaking && (
                  <motion.span
                    className="absolute inset-0 rounded-full border-4 border-primary/50"
                    initial={{ scale: 1 }}
                    animate={{
                      scale: [1, 1.15, 1],
                      opacity: [0.8, 0.4, 0.8],
                    }}
                    transition={{
                      duration: 1.2,
                      repeat: Number.POSITIVE_INFINITY,
                    }}
                  />
                )}
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  {callStatus === CallStatus.ACTIVE
                    ? isSpeaking
                      ? "Speaking..."
                      : "Listening..."
                    : callStatus === CallStatus.CONNECTING
                      ? "Connecting..."
                      : callStatus === CallStatus.FINISHED
                        ? "Interview Ended"
                        : "Ready to start"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* User Card or Recording */}
          {recordedVideoUrl ? (
            <Card className="bg-card/60 backdrop-blur-sm border-border/40">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">
                  Your Recording
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <video
                  src={recordedVideoUrl}
                  controls
                  className="w-full rounded-md border border-border/40"
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card/60 backdrop-blur-sm border-border/40">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">
                  {userName}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <div className="relative w-32 h-32">
                  <Image
                    src={userProfilePic}
                    alt="User Avatar"
                    fill
                    className="rounded-full object-cover border-2 border-border/30"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Call Controls */}
          <Card className="bg-card/60 backdrop-blur-sm border-border/40">
            <CardContent className="pt-6">
              {callStatus === CallStatus.ACTIVE ? (
                <Button
                  variant="destructive"
                  size="lg"
                  onClick={handleDisconnect}
                  className="w-full rounded-full"
                >
                  <PhoneOff className="mr-2 h-5 w-5" /> End Interview
                </Button>
              ) : callStatus === CallStatus.FINISHED ? (
                <div className="flex flex-col gap-4">
                  <Button
                    size="lg"
                    disabled={isGeneratingFeedback}
                    onClick={() =>
                      router.push(`/interview/${interviewId}/feedback`)
                    }
                    className="w-full rounded-full"
                  >
                    {isGeneratingFeedback ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Generating Feedback...
                      </>
                    ) : (
                      "View Feedback"
                    )}
                  </Button>
                </div>
              ) : (
                <Button
                  size="lg"
                  onClick={handleCall}
                  disabled={callStatus === CallStatus.CONNECTING}
                  className={cn(
                    "w-full rounded-full transition-all duration-300",
                    callStatus === CallStatus.CONNECTING &&
                      "opacity-75 cursor-wait",
                  )}
                >
                  {callStatus === CallStatus.CONNECTING ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />{" "}
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Phone className="mr-2 h-5 w-5" /> Start Interview
                    </>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Right Column: Messages History */}
        <section className="lg:col-span-2">
          <Card className="bg-card/60 backdrop-blur-sm border-border/40 flex flex-col">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Interview Transcript
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {messages.length > 0
                  ? `${messages.length} message${
                      messages.length !== 1 ? "s" : ""
                    }`
                  : "Messages will appear here during the interview"}
              </p>
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <ScrollArea className="h-[550px] p-6">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <MessageSquare className="h-16 w-16 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground text-sm">
                      Start the interview to see the conversation
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={cn(
                          "flex gap-3",
                          message.role === "user"
                            ? "justify-end"
                            : "justify-start",
                        )}
                      >
                        {message.role === "assistant" && (
                          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-primary">
                              AI
                            </span>
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[80%] rounded-2xl px-4 py-3",
                            message.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted",
                          )}
                        >
                          <p className="text-sm leading-relaxed">
                            {message.content}
                          </p>
                        </div>
                        {message.role === "user" && (
                          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-primary-foreground">
                              {userName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                      </motion.div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
