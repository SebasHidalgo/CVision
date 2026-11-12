// @vitest-environment jsdom
import { WORKLET_PATHS } from "@/lib/voice/elevenlabs/worklets";
import { createI18n } from "@/lib/i18n/instance";
import { RESOURCES } from "@/lib/i18n/resources";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisconnectionDetails } from "@elevenlabs/react";
import { I18nextProvider } from "react-i18next";
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
  onDebug?: (event: unknown) => void;
};

const sdk = vi.hoisted(() => ({
  callbacks: {} as Record<string, unknown>,
  startSession: vi.fn(),
  endSession: vi.fn(),
  sendContextualUpdate: vi.fn(),
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
        sendContextualUpdate: sdk.sendContextualUpdate,
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
  language: "es",
  resume: null,
  entry: { kind: "start", source: "period" },
  counts: { period: 3, periodLimit: 4, credits: 0 },
  offer: { prices: { pro: "US$15.00", pack: "US$9.00" }, proInterviewsPerMonth: 4, fullMinutes: 12, packCredits: 4, periodLimit: 4 },
};

const getUserMedia = vi.fn();

function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
}

/** The requests made so far, as [url, init] pairs. */
const requests = () => vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][];
const endedReports = () => requests().filter(([url]) => url === ENDED_URL);

const startButton = () => screen.getByRole("button", { name: /start the interview|reconnect/i });

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

/** The candidate says something: from then on a drop uses up interview time. */
async function answer() {
  await act(async () => {
    callbacks().onMessage?.({ role: "user", message: "I led the checkout rewrite." });
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
    expect(screen.getByText("3 of 4 interviews left this period. This one uses one of them.")).toBeTruthy();
    expect(screen.getByText(/Attempt 2$/)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(startButton().hasAttribute("disabled")).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("labels the attempt from the analysis's numbering, never from the start counter, and shows the entitlement's length and source", () => {
    render(<InterviewAgent {...props} attemptNumber={1} startCount={2} maxDurationSeconds={300} entry={{ kind: "start", source: "trial" }} />);

    expect(screen.getByText(/Attempt 1$/)).toBeTruthy();
    expect(screen.getByText("Up to 5 minutes")).toBeTruthy();
    expect(screen.getByText("This interview uses your free 5-minute trial.")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/starts? left/)).toBeNull();
    // The old cell that showed the start counter as "3 of 3" is gone.
    expect(screen.queryByText("3 of 3")).toBeNull();
  });

  it("says what a period start uses before Start", () => {
    render(<InterviewAgent {...props} />);
    expect(screen.getByText("3 of 4 interviews left this period. This one uses one of them.")).toBeTruthy();
  });

  it("on a Free account with the trial used, offers Pro on entry and no Start", () => {
    render(<InterviewAgent {...props} entry={{ kind: "needs-pro", reason: "trial-used" }} counts={{ period: 0, periodLimit: 0, credits: 0 }} maxDurationSeconds={0} />);
    expect(screen.queryByRole("button", { name: /start the interview/i })).toBeNull();
    expect(screen.getByText("You've used your free trial.")).toBeTruthy();
    expect(screen.getByText(/Go Pro to do this interview: 4 interviews a month, up to 12 minutes each/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Get Pro · US$15.00 a month" })).toBeTruthy();
    expect(screen.getByText("No interview available")).toBeTruthy();
    expect(screen.queryByLabelText("Interview length")).toBeNull();
  });

  it("on a Pro account with the period used, gives the renewal date and offers the pack, no Start", () => {
    render(<InterviewAgent {...props} entry={{ kind: "needs-pack", resetsAt: "2026-12-01T00:00:00.000Z" }} counts={{ period: 0, periodLimit: 4, credits: 0 }} maxDurationSeconds={0} />);
    expect(screen.queryByRole("button", { name: /start the interview/i })).toBeNull();
    expect(screen.getByText("Your 4 interviews renew on Dec 1.")).toBeTruthy();
    expect(screen.getByText(/A pack adds 4 full interviews for US\$9\.00/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buy 4 interviews · US$9.00" })).toBeTruthy();
  });

  it("with a paused subscription, shows its state and the billing portal instead of the Pro offer", () => {
    render(<InterviewAgent {...props} entry={{ kind: "needs-pro", reason: "had-voice", subscription: "paused" }} maxDurationSeconds={0} />);
    expect(screen.getByText("Your Pro subscription is paused.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /get pro/i })).toBeNull();
  });

  it("with a failed payment, keeps the pack offer and points to the billing portal", () => {
    render(<InterviewAgent {...props} entry={{ kind: "needs-pack", resetsAt: "2026-12-01T00:00:00.000Z", pastDue: true }} maxDurationSeconds={0} />);
    expect(screen.getByRole("button", { name: /buy 4 interviews/i })).toBeTruthy();
    expect(screen.getByText(/Your last payment didn't go through/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeTruthy();
  });

  it("with voice down, says so and sells nothing", () => {
    render(<InterviewAgent {...props} entry={{ kind: "voice-down" }} />);
    expect(screen.queryByRole("button", { name: /start the interview|get pro|buy/i })).toBeNull();
    expect(screen.getByText(/Voice interviews are temporarily unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
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
    render(<InterviewAgent {...props} maxDurationSeconds={720} entry={{ kind: "start", source: "credit" }} counts={{ period: 0, periodLimit: 0, credits: 2 }} />);
    expect(screen.getByText("Up to 12 minutes")).toBeTruthy();
    expect(screen.getByText("This interview uses 1 pack credit. You have 2.")).toBeTruthy();
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

  it("counts down from the session's limit, warning at one minute and again in the last ten seconds, in the interface language", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    // A Spanish session in an English interface: the warnings are interface copy.
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
    expect(screen.getByRole("status").textContent).toMatch(/one minute left/i);

    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    expect(screen.getByLabelText("Time left").textContent).toBe("0:10");
    expect(screen.getByRole("status").textContent).toMatch(/time is up/i);

    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(screen.getByLabelText("Time left").textContent).toBe("0:00");
    expect(sdk.endSession).not.toHaveBeenCalled();
  });

  it("tells the interviewer the time once, with about a minute left, in a line the candidate never hears", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    respond({ ok: true, data: { ...SESSION, maxDurationSeconds: 300 } });
    render(<InterviewAgent {...props} />);
    await clickStart();
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_1" });
    });

    act(() => {
      vi.advanceTimersByTime(149_000);
    });
    expect(sdk.sendContextualUpdate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(1);
    expect(sdk.sendContextualUpdate.mock.calls[0][0]).toMatch(/^\[time\] Half of the interview time has passed; about 2 minutes remain/);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(2);
    expect(sdk.sendContextualUpdate.mock.calls[1][0]).toMatch(/^\[time\] About two minutes remain/);
    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(3);
    expect(sdk.sendContextualUpdate.mock.calls[2][0]).toMatch(/^\[time\] About one minute remains/);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(3);
  });

  it("hangs up by itself when a call runs past its length, and reports it as finished", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    respond({ ok: true, data: { ...SESSION, maxDurationSeconds: 90, resumed: true } });
    render(<InterviewAgent {...props} />);
    await clickStart();
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_1" });
    });

    act(() => {
      vi.advanceTimersByTime(92_000);
    });
    expect(sdk.endSession).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(sdk.endSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "user" });
    });
    expect(endedReports()[0][1]?.body).toBe(JSON.stringify({ reason: "user", outcome: "finish" }));
    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
  });

  it("speaks the interface's Spanish while the session keeps the language the server issued", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    respond({ ok: true, data: { ...SESSION, language: "en", maxDurationSeconds: 60 } });
    render(
      <I18nextProvider i18n={createI18n("es", RESOURCES.es)}>
        <InterviewAgent {...props} />
      </I18nextProvider>,
    );
    expect(screen.getByText("Hasta 12 minutos")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /empezar la entrevista/i }));
    });
    expect(sdk.startSession).toHaveBeenCalledWith(expect.objectContaining({ overrides: { agent: { language: "en" } } }));
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_1" });
    });

    expect(screen.getByLabelText("Tiempo restante").textContent).toBe("1:00");
    expect(screen.getByRole("status").textContent).toMatch(/queda un minuto/i);
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
    expect(init).toMatchObject({ method: "POST", keepalive: true, body: JSON.stringify({ reason: "user", outcome: "finish" }) });
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

  it("when the interviewer hangs up early, before the wrap-up line, keeps the time: Continue or Finish, nothing scored yet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    respond({ ok: true, data: { ...SESSION, maxDurationSeconds: 300 } });
    render(<InterviewAgent {...props} />);
    await clickStart();
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_1" });
    });
    await answer();
    act(() => {
      vi.advanceTimersByTime(177_000);
    });

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "agent", context: { type: "end_call" } });
    });

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("The interview ended early. You still have 2:03.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /finish and get feedback/i })).toBeTruthy();
    expect(endedReports()[0][1]?.body).toBe(JSON.stringify({ reason: "agent", outcome: "drop" }));
    // The interviewer's mistake does not cost a connection: all three are still there.
    expect(screen.getByText("Continue — 3 starts left")).toBeTruthy();
  });

  it("after the wrap-up line, an interviewer hang-up is the end: the feedback page opens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    respond({ ok: true, data: { ...SESSION, maxDurationSeconds: 300 } });
    render(<InterviewAgent {...props} />);
    await clickStart();
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_1" });
    });
    await answer();
    act(() => {
      vi.advanceTimersByTime(235_000);
    });

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "agent", context: { type: "end_call" } });
    });

    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
  });

  it("shows no hint about the questions when there is nothing to start", () => {
    render(<InterviewAgent {...props} entry={{ kind: "needs-pro", reason: "trial-used" }} maxDurationSeconds={0} />);
    expect(screen.queryByText("The questions come from the posting and your analysis.")).toBeNull();
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

  it("on an unexpected disconnect, says when the call dropped and how much is left, and offers Reconnect and Finish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    render(<InterviewAgent {...props} startCount={1} />);
    await connect();
    await answer();
    act(() => {
      vi.advanceTimersByTime(192_000);
    });

    await act(async () => {
      callbacks().onDisconnect?.({
        reason: "error",
        message: "LiveKit connection state changed to disconnected",
        context: { type: "connection_state_changed" },
      });
    });

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("Connection lost")).toBeTruthy();
    expect(screen.getByText("Your call dropped at 3:12. You have 8:48 left.")).toBeTruthy();
    expect(screen.getByText(/picks up where you left off/i)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Reconnect — 1 start left");
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /finish and get feedback/i })).toBeTruthy();
    // The clock shows what is left of the interview, not its full length.
    expect(screen.getByLabelText("Interview length").textContent).toBe("8:48");
    expect(endedReports()[0][1]?.body).toBe(JSON.stringify({ reason: "error", outcome: "drop" }));

    respond({ ok: true, data: { ...SESSION, maxDurationSeconds: 528, resumed: true } });
    await clickStart();
    // The drop is reported again before the new session is asked for: the first report may not have left the browser.
    expect(requests().map(([url, init]) => `${url.split("/").pop()} ${init?.body ?? ""}`)).toEqual([
      `ended ${JSON.stringify({ reason: "reconnect", outcome: "drop" })}`,
      `session ${JSON.stringify({ language: "es" })}`,
    ]);
    expect(sdk.startSession).toHaveBeenCalledTimes(2);
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_2" });
    });
    expect(screen.getByLabelText("Time left").textContent).toBe("8:48");
    // A shorter resumed call is not "what pays for it changed".
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("Finish and get feedback closes the interview and opens its feedback", async () => {
    render(<InterviewAgent {...props} startCount={1} />);
    await connect();
    await answer();
    await act(async () => {
      callbacks().onDisconnect?.({ reason: "error", message: "x", context: { type: "close" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /finish and get feedback/i }));
    });

    const reports = endedReports();
    expect(reports[reports.length - 1][1]?.body).toBe(JSON.stringify({ reason: "finish", outcome: "finish" }));
    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
    expect(sdk.startSession).toHaveBeenCalledTimes(1);
  });

  it("opens on what is left when an earlier call of the interview dropped", async () => {
    render(<InterviewAgent {...props} startCount={1} resume={{ usedSeconds: 192, resumable: true }} />);

    expect(screen.getByText("Your call dropped at 3:12. You have 8:48 left.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    // The language was chosen on the first call: no selector on a reconnect.
    expect(screen.queryByLabelText("Interview language")).toBeNull();
  });

  it("offers only Finish when too little of the interview is left to reconnect", async () => {
    render(<InterviewAgent {...props} startCount={1} resume={{ usedSeconds: 700, resumable: false }} />);
    expect(screen.getByText(/too little time left to reconnect/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.getByRole("button", { name: /finish and get feedback/i })).toBeTruthy();
  });

  it("after the last start drops, offers no reconnect, says so, and still lets the candidate finish", async () => {
    render(<InterviewAgent {...props} startCount={2} />);
    await connect();
    await answer();

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "error", message: "x", context: { type: "close" } });
    });

    expect(screen.getByText(/no starts left for this interview/i)).toBeTruthy();
    expect(screen.queryByText(/Reconnect/)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /finish and get feedback/i })).toBeTruthy();
  });
});

describe("InterviewAgent: a tab closed mid-call", () => {
  it("reports the drop on the way out, so the interview is resumable at once", async () => {
    render(<InterviewAgent {...props} />);
    await connect();

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    const [, init] = endedReports()[0];
    expect(init).toMatchObject({ keepalive: true, body: JSON.stringify({ reason: "pagehide", outcome: "drop" }) });
  });

  it("reports nothing when the page is left before or after a call", async () => {
    render(<InterviewAgent {...props} />);
    respond({ ok: true, data: SESSION });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(endedReports()).toHaveLength(0);
  });
});

describe("InterviewAgent: the language of the call", () => {
  it("proposes the language it was given and sends the one chosen with the start", async () => {
    respond({ ok: true, data: { ...SESSION, language: "en" } });
    render(<InterviewAgent {...props} language="es" />);

    const select = screen.getByLabelText("Interview language") as HTMLSelectElement;
    expect(select.value).toBe("es");
    expect([...select.options].map((option) => option.textContent)).toEqual(["English", "Spanish"]);

    fireEvent.change(select, { target: { value: "en" } });
    await clickStart();

    const [url, init] = requests()[0];
    expect(url).toBe(`/api/interview/${INTERVIEW_ID}/session`);
    expect(init?.body).toBe(JSON.stringify({ language: "en" }));
    expect(sdk.startSession).toHaveBeenCalledWith(expect.objectContaining({ overrides: { agent: { language: "en" } } }));
  });
});

describe("InterviewAgent: a full house", () => {
  it("shows a waiting state while the platform holds the call in line, and starts the clock when it is let through", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    render(<InterviewAgent {...props} />);
    await connect();

    await act(async () => {
      callbacks().onDebug?.({ type: "queue_status", queue_status_event: { status: "waiting" } });
    });
    expect(screen.getByText("Waiting in line")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/all interviewers are busy right now/i);
    expect(screen.getByRole("status").textContent).toMatch(/nothing is charged while you wait/i);
    expect(screen.getByRole("button", { name: /waiting for an interviewer/i }).hasAttribute("disabled")).toBe(true);

    // Twenty seconds in line use none of the interview.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    await act(async () => {
      callbacks().onDebug?.({ type: "queue_status", queue_status_event: { status: "admitted" } });
    });
    expect(screen.getByLabelText("Time left").textContent).toBe("12:00");
    expect(screen.getByRole("button", { name: /end the interview/i })).toBeTruthy();
  });

  it("says every interviewer is busy when the wait runs out, charges nothing and stays in the room", async () => {
    render(<InterviewAgent {...props} />);
    await connect();
    await act(async () => {
      callbacks().onDebug?.({ type: "queue_status", queue_status_event: { status: "waiting" } });
    });

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "agent", context: { type: "close", reason: "agent disconnected" } });
    });

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("All interviewers are busy right now. Try again in a minute. Nothing was charged.");
    expect(screen.getByRole("button", { name: /start the interview/i })).toBeTruthy();
    // Reported as an end, with no outcome: nothing to resume and nothing finished.
    expect(endedReports()[0][1]?.body).toBe(JSON.stringify({ reason: "agent" }));
  });

  it("says so when the platform refuses the call for capacity before it connects", async () => {
    respond({ ok: true, data: SESSION });
    render(<InterviewAgent {...props} />);
    await clickStart();

    await act(async () => {
      callbacks().onDisconnect?.({
        reason: "error",
        message: "This AI agent is currently at max capacity. Please try again later.",
        context: { type: "close", code: 4300 },
        closeCode: 4300,
      });
    });

    expect(screen.getByRole("status").textContent).toBe("All interviewers are busy right now. Try again in a minute. Nothing was charged.");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("InterviewAgent: a call that drops before the candidate said anything", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts again with the full length: no time used, no Finish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    render(<InterviewAgent {...props} />);
    await connect();
    // The interviewer spoke; the candidate did not.
    await act(async () => {
      callbacks().onMessage?.({ role: "agent", message: "Hi Ana, thanks for joining." });
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    await act(async () => {
      callbacks().onDisconnect?.({ reason: "error", message: "x", context: { type: "close" } });
    });

    expect(screen.getByText("Your call dropped before you answered. You can start again with the full 12 minutes.")).toBeTruthy();
    expect(screen.queryByText(/Your call dropped at/)).toBeNull();
    expect(screen.queryByRole("button", { name: /finish and get feedback/i })).toBeNull();
    // What the server will give the next start: the whole interview.
    expect(screen.getByLabelText("Interview length").textContent).toBe("12:00");
    expect(push).not.toHaveBeenCalled();
    expect(endedReports().map(([, init]) => init?.body)).toEqual([JSON.stringify({ reason: "error", outcome: "drop" })]);

    respond({ ok: true, data: { ...SESSION, resumed: false } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    });
    // No "reconnect" report first: there is no dropped interview to continue.
    expect(requests().map(([url]) => url.split("/").pop())).toEqual(["session"]);
  });

  it("a silent drop on the last start has nothing to start again: the feedback page explains it", async () => {
    render(<InterviewAgent {...props} startCount={2} />);
    await connect();
    await act(async () => {
      callbacks().onDisconnect?.({ reason: "error", message: "x", context: { type: "close" } });
    });
    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
  });
});
