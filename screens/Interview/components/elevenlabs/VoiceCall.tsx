"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { WORKLET_PATHS } from "@/lib/voice/elevenlabs/worklets";

/**
 * The browser side of the voice provider: the only file that imports the
 * ElevenLabs SDK. The room talks to it in its own words (start with what the
 * server issued, end, who is speaking, how the call ended).
 */

export type VoiceCallStart = {
  token: string;
  /** Exactly what the server issued; passed on untouched. */
  variables: Record<string, string>;
  language: "en" | "es";
};

export type VoiceCallEnd = {
  /** Who or what ended it, in the provider word the server logs. */
  reason: string;
  /** The interviewer or the candidate closed the call, or its time ran out: not a drop. */
  finished: boolean;
};

export type VoiceCallHandlers = {
  onConnect: () => void;
  onEnd: (end: VoiceCallEnd) => void;
  onError: (message: string) => void;
  onLine: (line: { role: "user" | "agent"; text: string }) => void;
  /** An interrupted line, corrected to what was actually said. */
  onLineCorrected: (change: { original: string; corrected: string }) => void;
};

export function VoiceCallProvider({ children }: { children: React.ReactNode }) {
  return <ConversationProvider>{children}</ConversationProvider>;
}

export function useVoiceCall(handlers: VoiceCallHandlers) {
  const { startSession, endSession, mode } = useConversation({
    onConnect: handlers.onConnect,
    onDisconnect: (details) => {
      // The platform hard limit arrives as an error event; it is the agent ending the call.
      const finished =
        details.reason === "user" ||
        details.reason === "agent" ||
        (details.reason === "error" && details.context.type === "max_duration_exceeded");
      handlers.onEnd({ reason: details.reason, finished });
    },
    onError: handlers.onError,
    onMessage: ({ role, message }) => handlers.onLine({ role, text: message }),
    onAgentResponseCorrection: ({ original_agent_response, corrected_agent_response }) =>
      handlers.onLineCorrected({ original: original_agent_response, corrected: corrected_agent_response }),
  });

  return {
    /** "speaking" while the interviewer talks, "listening" otherwise. */
    mode,
    start: ({ token, variables, language }: VoiceCallStart) =>
      startSession({
        connectionType: "webrtc",
        conversationToken: token,
        dynamicVariables: variables,
        overrides: { agent: { language } },
        // The SDK audio worklets from this origin, not from blob: URLs the CSP refuses.
        workletPaths: WORKLET_PATHS,
      }),
    /** Resolves nothing: the end arrives through `onEnd`. */
    end: () => endSession(),
  };
}
