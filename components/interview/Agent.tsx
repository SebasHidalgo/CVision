"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessageSquare, Phone, PhoneOff } from "lucide-react";
import { vapi } from "@/lib/vapi.sdk";
import { interviewer } from "@/constants";
import { ScrollArea } from "../ui/scroll-area";

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

type AgentProps = {
  userName: string;
  userId?: string;
  interviewId?: string;
  feedbackId?: string;
  type: "generate" | "interview";
  questions?: string[];
  userProfilePic: string;
};

export default function Agent({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
  userProfilePic,
}: AgentProps) {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const onCallStart = () => setCallStatus(CallStatus.ACTIVE);
    const onCallEnd = () => setCallStatus(CallStatus.FINISHED);

    const onMessage = (message: any) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        const newMessage = { role: message.role, content: message.transcript };
        setMessages((prev) => [...prev, newMessage]);
      }
    };

    const onSpeechStart = () => setIsSpeaking(true);
    const onSpeechEnd = () => setIsSpeaking(false);
    const onError = (error: Error) => console.error("Error:", error);

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
    };
  }, []);

  useEffect(() => {
    if (callStatus === CallStatus.FINISHED) {
      if (type === "generate") {
        router.push("/");
      } else {
        // Generate feedback logic if needed
      }
    }
  }, [messages, callStatus, feedbackId, interviewId, router, type, userId]);

  const handleCall = async () => {
    setCallStatus(CallStatus.CONNECTING);

    if (type === "generate") {
      await vapi.start(
        undefined,
        undefined,
        undefined,
        process.env.NEXT_PUBLIC_VAPI_WORKFLOW_ID!,
        { variableValues: { username: userName, userid: userId } }
      );
    } else {
      let formattedQuestions = "";
      if (questions) {
        formattedQuestions = questions.map((q) => `- ${q}`).join("\n");
      }

      await vapi.start(interviewer, {
        variableValues: { questions: formattedQuestions },
      });
    }
  };

  const handleDisconnect = () => {
    setCallStatus(CallStatus.FINISHED);
    vapi.stop();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-muted/30 to-background">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-8rem)]">
          {/* Left Column: Interview Controls */}
          <div className="lg:col-span-1 flex flex-col gap-6">
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

            {/* User Card */}
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
                ) : (
                  <Button
                    size="lg"
                    onClick={handleCall}
                    disabled={callStatus === CallStatus.CONNECTING}
                    className={cn(
                      "w-full rounded-full transition-all duration-300",
                      callStatus === CallStatus.CONNECTING &&
                        "opacity-75 cursor-wait"
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
          </div>

          {/* Right Column: Messages History */}
          <div className="lg:col-span-2">
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
                              : "justify-start"
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
                                : "bg-muted"
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
          </div>
        </div>
      </div>
    </div>
  );
}
