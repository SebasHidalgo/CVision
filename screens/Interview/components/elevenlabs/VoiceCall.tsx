"use client";

import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import { END_INTERVIEW_TOOL, END_TOOL_REFUSED } from "@/lib/voice/callEnd";
import { WORKLET_PATHS } from "@/lib/voice/elevenlabs/worklets";

/**
 * The browser side of the voice provider: the only file that imports the
 * ElevenLabs SDK. The room talks to it in its own words (start with what the
 * server issued, end, who is speaking, how the call ended, whether it is
 * waiting in line).
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
  /** The platform refused the call because every interviewer was taken. */
  busy: boolean;
  /** The platform's time limit ended it. */
  limit: boolean;
};

export type VoiceCallHandlers = {
  onConnect: () => void;
  onEnd: (end: VoiceCallEnd) => void;
  onError: (message: string) => void;
  onLine: (line: { role: "user" | "agent"; text: string }) => void;
  /** An interrupted line, corrected to what was actually said. */
  onLineCorrected: (change: { original: string; corrected: string }) => void;
  /** Held in the platform's queue ("waiting"), then let through ("admitted"). */
  onQueue: (status: "waiting" | "admitted") => void;
  /** The interviewer asks the room to end the call; the answer goes back to it (REFUSED… at once; ALLOWED… when the room has something to say before it hangs up). */
  onEndRequest: (reason: unknown) => string | Promise<string>;
};

/** The platform's close code and wording for "at max capacity" (seen live, code 4300). */
const BUSY_CLOSE_CODE = 4300;
const BUSY_TEXT = /max capacity|at capacity/i;

/** The queue event the SDK has no callback for: it reaches `onDebug` as a raw event. */
function queueStatus(event: unknown): "waiting" | "admitted" | null {
  if (typeof event !== "object" || event === null) return null;
  const { type, queue_status_event: detail } = event as { type?: unknown; queue_status_event?: { status?: unknown } };
  if (type !== "queue_status") return null;
  return detail?.status === "waiting" || detail?.status === "admitted" ? detail.status : null;
}

export function VoiceCallProvider({ children }: { children: React.ReactNode }) {
  return <ConversationProvider>{children}</ConversationProvider>;
}

export function useVoiceCall(handlers: VoiceCallHandlers) {
  // The interviewer's only way to end the call: a tool this room answers. A handler that breaks must not end it.
  useConversationClientTool(END_INTERVIEW_TOOL, (parameters: unknown) => {
    try {
      return handlers.onEndRequest((parameters as { reason?: unknown } | null | undefined)?.reason);
    } catch (error) {
      console.error("[CVision][room] end_interview handler failed:", error);
      return `${END_TOOL_REFUSED}: the call continues. Ask your next interview question.`;
    }
  });
  const { startSession, endSession, sendContextualUpdate, sendUserMessage, mode } = useConversation({
    onConnect: handlers.onConnect,
    onDisconnect: (details) => {
      // The platform hard limit arrives as an error event; it is the agent ending the call.
      const limit = details.reason === "error" && details.context.type === "max_duration_exceeded";
      const finished = details.reason === "user" || details.reason === "agent" || limit;
      const text = details.reason === "user" ? "" : [details.reason === "error" ? details.message : "", details.closeReason, details.context?.reason].join(" ");
      const busy = details.reason !== "user" && (details.closeCode === BUSY_CLOSE_CODE || details.context?.code === BUSY_CLOSE_CODE || BUSY_TEXT.test(text));
      handlers.onEnd({ reason: details.reason, finished, busy, limit });
    },
    onError: handlers.onError,
    onMessage: ({ role, message }) => handlers.onLine({ role, text: message }),
    onAgentResponseCorrection: ({ original_agent_response, corrected_agent_response }) =>
      handlers.onLineCorrected({ original: original_agent_response, corrected: corrected_agent_response }),
    onDebug: (event: unknown) => {
      const status = queueStatus(event);
      if (!status) return;
      // For support: a call that waited says so in the browser console.
      console.info(`[CVision][room] queue: ${status}`);
      handlers.onQueue(status);
    },
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
    /** A note for the interviewer that the candidate does not hear: the room's clock. */
    notify: (text: string) => sendContextualUpdate(text),
    /** Dev tools only: a typed candidate line, for the voice e2e. */
    say: (text: string) => sendUserMessage(text),
  };
}
