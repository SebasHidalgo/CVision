// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceCall, VoiceCallProvider, type VoiceCallHandlers } from "./VoiceCall";

// The SDK at its module boundary: the tool the room registers is called here as the platform would.
const sdk = vi.hoisted(() => ({
  tools: {} as Record<string, (parameters: unknown) => unknown>,
  options: {} as Record<string, unknown>,
  sendContextualUpdate: vi.fn(),
  sendUserMessage: vi.fn(),
}));

vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useConversationClientTool: (name: string, handler: (parameters: unknown) => unknown) => {
    sdk.tools[name] = handler;
  },
  useConversation: (options: Record<string, unknown>) => {
    sdk.options = options;
    return { startSession: vi.fn(), endSession: vi.fn(), sendContextualUpdate: sdk.sendContextualUpdate, sendUserMessage: sdk.sendUserMessage, mode: "listening" };
  },
}));

const handlers = (onEndRequest: VoiceCallHandlers["onEndRequest"]): VoiceCallHandlers => ({
  onConnect: () => {},
  onEnd: () => {},
  onError: () => {},
  onLine: () => {},
  onLineCorrected: () => {},
  onQueue: () => {},
  onEndRequest,
});

let call: ReturnType<typeof useVoiceCall>;
function Room({ onEndRequest }: { onEndRequest: VoiceCallHandlers["onEndRequest"] }) {
  call = useVoiceCall(handlers(onEndRequest));
  return null;
}

const mount = (onEndRequest: VoiceCallHandlers["onEndRequest"]) =>
  render(
    <VoiceCallProvider>
      <Room onEndRequest={onEndRequest} />
    </VoiceCallProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  sdk.tools = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(cleanup);

describe("useVoiceCall: the end_interview client tool", () => {
  it("registers one tool, end_interview, and hands the room the reason the interviewer gave", () => {
    const onEndRequest = vi.fn(() => "ALLOWED: say the goodbye now.");
    mount(onEndRequest);

    expect(Object.keys(sdk.tools)).toEqual(["end_interview"]);
    expect(sdk.tools.end_interview({ reason: "time_up" })).toBe("ALLOWED: say the goodbye now.");
    expect(onEndRequest).toHaveBeenCalledWith("time_up");
  });

  it.each([undefined, null, {}, "time_up"])("passes no reason when the platform sends %j as the parameters", (parameters) => {
    const onEndRequest = vi.fn(() => "REFUSED: the call continues.");
    mount(onEndRequest);

    expect(sdk.tools.end_interview(parameters)).toBe("REFUSED: the call continues.");
    expect(onEndRequest).toHaveBeenCalledWith(undefined);
  });

  it("answers REFUSED when the room's handler throws: a broken handler never ends a call", () => {
    mount(() => {
      throw new Error("boom");
    });

    const result = String(sdk.tools.end_interview({ reason: "time_up" }));

    expect(result).toMatch(/^REFUSED: the call continues\./);
    expect(result).toMatch(/Ask your next interview question\.$/);
    expect(console.error).toHaveBeenCalledWith("[CVision][room] end_interview handler failed:", expect.any(Error));
  });

  it("sends a [time] line as a contextual update and, for the dev hooks, a typed line as a user message", () => {
    mount(() => "");

    call.notify("[time] About one minute remains.");
    call.say("That is all I have.");

    expect(sdk.sendContextualUpdate).toHaveBeenCalledWith("[time] About one minute remains.");
    expect(sdk.sendUserMessage).toHaveBeenCalledWith("That is all I have.");
  });
});
