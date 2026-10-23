// @vitest-environment jsdom
import { WORKLET_PATHS } from "@/lib/elevenlabs/worklets";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisconnectionDetails } from "@elevenlabs/react";
import InterviewAgent, { type InterviewAgentProps } from "./InterviewAgent";

/**
 * The SDK is stubbed at its module boundary: a provider that renders its
 * children and a hook whose callbacks the tests fire by hand. No test here
 * opens a connection, and the network block in vitest.setup.ts would fail
 * one that tried.
 */
type Callbacks = {
  onConnect?: (props: { conversationId: string }) => void;
  onDisconnect?: (details: DisconnectionDetails) => void;
  onError?: (message: string) => void;
  onMessage?: (props: { role: "user" | "agent"; message: string }) => void;
  onAgentResponseCorrection?: (props: {
    original_agent_response: string;
    corrected_agent_response: string;
  }) => void;
};

const sdk = vi.hoisted(() => ({
  callbacks: {} as Record<string, unknown>,
  startSession: vi.fn(),
  endSession: vi.fn(),
  setMode: (_mode: "speaking" | "listening") => {},
}));

vi.mock("@elevenlabs/react", async () => {
  const React = await import("react");
  return {
    ConversationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useConversation: (options: Record<string, unknown>) => {
      sdk.callbacks = options;
      const [mode, setMode] = React.useState<"speaking" | "listening">("listening");
      sdk.setMode = setMode;
      return {
        startSession: sdk.startSession,
        endSession: sdk.endSession,
        mode,
        isSpeaking: mode === "speaking",
        isListening: mode === "listening",
        status: "connected",
      };
    },
  };
});

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const callbacks = () => sdk.callbacks as Callbacks;

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const ANALYSIS_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const ENDED_URL = `/api/interview/${INTERVIEW_ID}/ended`;

const SESSION = {
  connectionType: "webrtc" as const,
  conversationToken: "tok_1",
  conversationId: "conv_1",
  dynamicVariables: {
    interview_id: INTERVIEW_ID,
    candidate_name: "Ana",
    requirements_gaps: "- [required, missing] Kubernetes",
  },
  language: "es" as const,
  expiresAt: "2026-10-12T10:15:00.000Z",
  maxDurationSeconds: 720,
  source: "period" as const,
};

const props: InterviewAgentProps = {
  interviewId: INTERVIEW_ID,
  role: "Backend Engineer",
  company: "Northwind",
  candidateName: "Ana",
  analysisId: ANALYSIS_ID,
  attemptNumber: 2,
  startCount: 0,
  maxStarts: 3,
  maxDurationSeconds: 720,
  source: "period",
};

const getUserMedia = vi.fn();

function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
}

/** The requests made so far, as [url, init] pairs. */
const requests = () => vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][];
const endedReports = () => requests().filter(([url]) => url === ENDED_URL);

const startButton = () => screen.getByRole("button", { name: /start the interview|try again/i });

async function clickStart() {
  await act(async () => {
    fireEvent.click(startButton());
  });
}

async function connect() {
  respond({ ok: true, data: SESSION });
  await clickStart();
  await act(async () => {
    callbacks().onConnect?.({ conversationId: "conv_1" });
  });
}

beforeAll(() => {
  // jsdom has neither; framer-motion reads the first, the transcript log calls the second.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Element.prototype.scrollTo = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: () => {} }] });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("InterviewAgent: before the call", () => {
  it("shows the role, company, candidate, length and the attempt of the analysis, with one Start button", () => {
    render(<InterviewAgent {...props} startCount={1} />);

    expect(screen.getByRole("heading", { name: "Backend Engineer" })).toBeTruthy();
    expect(screen.getByText("Northwind")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("Up to 12 minutes")).toBeTruthy();
    expect(screen.getByText("Uses one of this period's interviews.")).toBeTruthy();
    expect(screen.getByText(/Attempt 2$/)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(startButton().hasAttribute("disabled")).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("labels the attempt from the analysis's numbering, never from the start counter, and shows the entitlement's length and source", () => {
    render(<InterviewAgent {...props} attemptNumber={1} startCount={2} maxDurationSeconds={300} source="trial" />);

    expect(screen.getByText(/Attempt 1$/)).toBeTruthy();
    expect(screen.getByText("Up to 5 minutes")).toBeTruthy();
    expect(screen.getByText("Your free trial, on us.")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/starts? left/)).toBeNull();
    // The old cell that showed the start counter as "3 of 3" is gone.
    expect(screen.queryByText("3 of 3")).toBeNull();
  });

  it("at the start cap, explains that connections are what ran out and links to the analysis instead of Start", () => {
    render(<InterviewAgent {...props} startCount={3} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("No starts left")).toBeTruthy();
    expect(screen.getByText(/every connection to the interviewer counts as one/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to the analysis/i }).getAttribute("href")).toBe(
      `/resume/analysis/${ANALYSIS_ID}`,
    );
  });
});

describe("InterviewAgent: starting", () => {
  it("asks for the microphone on Start and, when denied, names the browser setting and re-enables Start without a session call", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    respond({ ok: true, data: SESSION });
    render(<InterviewAgent {...props} />);

    await clickStart();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(screen.getByRole("status").textContent).toMatch(/site settings/);
    expect(fetch).not.toHaveBeenCalled();
    expect(sdk.startSession).not.toHaveBeenCalled();
    expect(startButton().hasAttribute("disabled")).toBe(false);
  });

  it("on 2xx, starts the SDK over WebRTC with the token, the variables untouched and the language override", async () => {
    respond({ ok: true, data: SESSION });
    render(<InterviewAgent {...props} />);

    await clickStart();

    expect(fetch).toHaveBeenCalledWith(
      `/api/interview/${INTERVIEW_ID}/session`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(sdk.startSession).toHaveBeenCalledTimes(1);
    expect(sdk.startSession).toHaveBeenCalledWith({
      connectionType: "webrtc",
      conversationToken: "tok_1",
      dynamicVariables: SESSION.dynamicVariables,
      overrides: { agent: { language: "es" } },
      workletPaths: WORKLET_PATHS,
    });
    // Status line and button both say so.
    expect(screen.getAllByText("Connecting")).toHaveLength(2);
  });

  it.each([
    { when: "the middleware answers a 404 page", body: "<!doctype html>", status: 404, copy: /didn't go through/ },
    { when: "the server answers 409 at the cap", body: { ok: false, code: "INTERVIEW_START_LIMIT" }, status: 409, copy: /all of its starts/ },
    { when: "the server answers 409 for an ended interview", body: { ok: false, code: "INTERVIEW_NOT_STARTABLE" }, status: 409, copy: /already ended/ },
    { when: "the server answers 503", body: { ok: false, code: "VOICE_UNAVAILABLE" }, status: 503, copy: /temporarily unavailable/ },
  ])("shows the copy and does not start the SDK when $when", async ({ body, status, copy }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status }),
      ),
    );
    render(<InterviewAgent {...props} />);

    await clickStart();

    expect(screen.getByRole("status").textContent).toMatch(copy);
    expect(sdk.startSession).not.toHaveBeenCalled();
  });

  it("re-enables Start after a 409 that is not the cap, and hides it after the cap", async () => {
    respond({ ok: false, code: "INTERVIEW_NOT_STARTABLE" }, 409);
    const view = render(<InterviewAgent {...props} />);
    await clickStart();
    expect(startButton().hasAttribute("disabled")).toBe(false);
    view.unmount();

    respond({ ok: false, code: "INTERVIEW_START_LIMIT" }, 409);
    render(<InterviewAgent {...props} startCount={2} />);
    await clickStart();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: /back to the analysis/i })).toBeTruthy();
  });

  it("shows REQUEST_FAILED when the fetch itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<InterviewAgent {...props} />);

    await clickStart();

    expect(screen.getByRole("status").textContent).toMatch(/didn't go through/);
    expect(sdk.startSession).not.toHaveBeenCalled();
    expect(startButton().hasAttribute("disabled")).toBe(false);
  });

  it("re-enables Start when the SDK fails to connect after a session was issued, without showing the start counter", async () => {
    respond({ ok: true, data: SESSION });
    render(<InterviewAgent {...props} />);
    await clickStart();

    await act(async () => {
      callbacks().onError?.("Failed to fetch conversation token");
    });

    expect(screen.getByRole("status").textContent).toMatch(/temporarily unavailable/);
    expect(startButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/starts? left/)).toBeNull();
  });
});

describe("InterviewAgent: during the call", () => {
  it("drives the state indicator from the SDK's mode and shows the transcript with corrections", async () => {
    render(<InterviewAgent {...props} />);
    await connect();

    expect(screen.getByText("Your turn")).toBeTruthy();
    act(() => sdk.setMode("speaking"));
    expect(screen.getByText("Interviewer speaking")).toBeTruthy();
    act(() => sdk.setMode("listening"));
    expect(screen.getByText("Your turn")).toBeTruthy();

    await act(async () => {
      callbacks().onMessage?.({ role: "agent", message: "Tell me about Kubernetes, and also about Docker." });
      callbacks().onMessage?.({ role: "user", message: "We run everything on EKS." });
    });
    expect(screen.getByText("Tell me about Kubernetes, and also about Docker.")).toBeTruthy();
    expect(screen.getByText("We run everything on EKS.")).toBeTruthy();
    expect(screen.getByText("Interviewer")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();

    await act(async () => {
      callbacks().onAgentResponseCorrection?.({
        original_agent_response: "Tell me about Kubernetes, and also about Docker.",
        corrected_agent_response: "Tell me about Kubernetes,",
      });
    });
    expect(screen.queryByText("Tell me about Kubernetes, and also about Docker.")).toBeNull();
    expect(screen.getByText("Tell me about Kubernetes,")).toBeTruthy();

    // Nothing in the transcript was posted anywhere: the one request was the session.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows the session's length after Start and says so when it differs from what the page promised, never jumping silently", async () => {
    // The page promised a credit's twelve minutes; a credit spent elsewhere left the trial's five.
    respond({ ok: true, data: { ...SESSION, maxDurationSeconds: 300, source: "trial" } });
    render(<InterviewAgent {...props} maxDurationSeconds={720} source="credit" />);
    expect(screen.getByText("Up to 12 minutes")).toBeTruthy();
    expect(screen.getByText("Uses one credit.")).toBeTruthy();
    await clickStart();
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_1" });
    });
    expect(screen.getByRole("note").textContent).toMatch(/This call runs 5 minutes, not 12/);
    expect(screen.getByLabelText("Time left").textContent).toBe("5:00");
  });

  it("says nothing extra when the session confirms the page's length", async () => {
    respond({ ok: true, data: { ...SESSION, maxDurationSeconds: 720, source: "period" } });
    render(<InterviewAgent {...props} />);
    await clickStart();
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_1" });
    });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("counts down from the session's limit, warning at one minute and again in the last ten seconds, in the session's language", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    respond({ ok: true, data: { ...SESSION, maxDurationSeconds: 75 } });
    render(<InterviewAgent {...props} />);
    await clickStart();
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_1" });
    });

    expect(screen.getByLabelText("Time left").textContent).toBe("1:15");
    expect(screen.getByRole("status").textContent).toMatch(/speak naturally/i);

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByLabelText("Time left").textContent).toBe("1:00");
    expect(screen.getByRole("status").textContent).toMatch(/queda un minuto/i);

    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    expect(screen.getByLabelText("Time left").textContent).toBe("0:10");
    expect(screen.getByRole("status").textContent).toMatch(/se acabó el tiempo/i);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByLabelText("Time left").textContent).toBe("0:00");
  });
});

describe("InterviewAgent: ending", () => {
  it("End calls endSession, waits for the disconnect, then reports the end and opens the feedback page", async () => {
    render(<InterviewAgent {...props} />);
    await connect();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /end the interview/i }));
    });
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(endedReports()).toHaveLength(0);
    expect(screen.getByText("Ending the interview")).toBeTruthy();

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "user" });
    });
    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
    // One session request, one end-of-call report with the SDK's reason, kept alive past the navigation.
    expect(fetch).toHaveBeenCalledTimes(2);
    const [, init] = endedReports()[0];
    expect(init).toMatchObject({ method: "POST", keepalive: true, body: JSON.stringify({ reason: "user" }) });
  });

  it.each<DisconnectionDetails>([
    { reason: "agent", context: { type: "close", reason: "agent disconnected" } },
    { reason: "error", message: "max duration", context: { type: "max_duration_exceeded" } },
  ])("opens the feedback page and reports the reason when the call ends from the other side ($reason)", async (details) => {
    render(<InterviewAgent {...props} />);
    await connect();

    await act(async () => {
      callbacks().onDisconnect?.(details);
    });

    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
    expect(endedReports()[0][1]?.body).toBe(JSON.stringify({ reason: details.reason }));
  });

  it("does not wait on the report: the feedback page opens even when it fails", async () => {
    render(<InterviewAgent {...props} />);
    await connect();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "agent", context: { type: "end_call" } });
    });

    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
    expect(fetch).toHaveBeenCalledWith(ENDED_URL, expect.anything());
  });

  it("on an unexpected disconnect, says the connection was lost, shows the starts left next to Try again, and Try again goes through Start", async () => {
    render(<InterviewAgent {...props} startCount={1} />);
    await connect();

    await act(async () => {
      callbacks().onDisconnect?.({
        reason: "error",
        message: "LiveKit connection state changed to disconnected",
        context: { type: "connection_state_changed" },
      });
    });

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("Connection lost")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Reconnect — 1 start left");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /check for feedback/i }).getAttribute("href")).toBe(
      `/interview/${INTERVIEW_ID}/feedback?ended=1`,
    );
    expect(endedReports()[0][1]?.body).toBe(JSON.stringify({ reason: "error" }));

    await clickStart();
    // Session, report, session again.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sdk.startSession).toHaveBeenCalledTimes(2);
  });

  it("after the last start drops, offers no retry and says so", async () => {
    render(<InterviewAgent {...props} startCount={2} />);
    await connect();

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "error", message: "x", context: { type: "close" } });
    });

    expect(screen.getByText(/no starts left for this interview/i)).toBeTruthy();
    expect(screen.queryByText(/Reconnect/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
