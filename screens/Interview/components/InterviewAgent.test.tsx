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
  sendUserMessage: vi.fn(),
  /** The client tools the room registered, by name: a test calls one as the platform would. */
  tools: {} as Record<string, (parameters: unknown) => unknown>,
  setMode: (_mode: "speaking" | "listening") => {},
}));

vi.mock("@elevenlabs/react", async () => {
  const React = await import("react");
  return {
    ConversationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    // The real hook keeps the latest handler by ref; the stub takes the one of the latest render.
    useConversationClientTool: (name: string, handler: (parameters: unknown) => unknown) => {
      sdk.tools[name] = handler;
    },
    useConversation: (options: Record<string, unknown>) => {
      sdk.callbacks = options;
      const [mode, setMode] = React.useState<"speaking" | "listening">("listening");
      sdk.setMode = setMode;
      return {
        startSession: sdk.startSession,
        endSession: sdk.endSession,
        sendContextualUpdate: sdk.sendContextualUpdate,
        sendUserMessage: sdk.sendUserMessage,
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
/** One end report, parsed: the reason, how the room read it, why it ended and the room's own clock. */
const report = (index = 0) => JSON.parse(String(endedReports()[index][1]?.body)) as Record<string, unknown>;

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

/** A call on fake timers, connected, of this paid length. */
async function liveCall(seconds: number, session: Record<string, unknown> = {}, ui: React.ReactNode = <InterviewAgent {...props} />) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
  respond({ ok: true, data: { ...SESSION, maxDurationSeconds: seconds, ...session } });
  render(ui);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /start the interview|empezar la entrevista|reconnect/i }));
  });
  await act(async () => {
    callbacks().onConnect?.({ conversationId: "conv_1" });
  });
}

/** The clock moves; one act per step, so the room re-reads its state between steps. */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The interviewer calls end_interview: what the room answers. */
/** The interviewer's tool call as the platform delivers it: a refusal is answered at once, as a string. */
function askToEnd(reason: unknown): string {
  let result: unknown;
  act(() => {
    result = sdk.tools.end_interview?.({ reason });
  });
  return String(result);
}

/** A call the room allows is held open while the goodbye is spoken: what it answers, if and when it does. */
function askToEndAllowed(reason: unknown): string[] {
  const answers: string[] = [];
  let result: unknown;
  act(() => {
    result = sdk.tools.end_interview?.({ reason });
  });
  expect(result).toBeInstanceOf(Promise);
  void (result as Promise<string>).then((answer) => answers.push(answer));
  return answers;
}

/** Lets a resolved answer reach its listener. */
const settled = () => act(async () => {});

async function say(role: "user" | "agent", message: string) {
  await act(async () => {
    callbacks().onMessage?.({ role, message });
  });
}

const GOODBYE = "Thanks for practicing, Ana. Your feedback will appear on your screen in a moment.";
const clock = () => screen.getByLabelText("Time left").textContent;

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
  // The room logs each end_interview call for support.
  vi.spyOn(console, "info").mockImplementation(() => {});
  sdk.tools = {};
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

  it("counts down the paid length, says the last minute is still interview, and at 0:00 shows the closing label while the call runs on", async () => {
    // A Spanish session in an English interface: the warnings are interface copy.
    await liveCall(75);

    expect(clock()).toBe("1:15");
    expect(screen.getByRole("status").textContent).toMatch(/speak naturally/i);

    tick(15_000);
    expect(clock()).toBe("1:00");
    expect(screen.getByRole("status").textContent).toBe("Last minute. The interviewer keeps asking until the time is up.");

    tick(50_000);
    expect(clock()).toBe("0:10");
    expect(screen.getByRole("status").textContent).toBe("A few seconds left.");

    tick(10_000);
    expect(clock()).toBe("Time's up · closing…");
    expect(screen.getByRole("status").textContent).toBe("Time's up. Finish your answer; the interviewer will say goodbye and close the call.");
    expect(sdk.endSession).not.toHaveBeenCalled();

    // Through the grace the label stays: never a negative time, and the call is still live.
    tick(40_000);
    expect(clock()).toBe("Time's up · closing…");
    expect(sdk.endSession).not.toHaveBeenCalled();
    expect(endedReports()).toHaveLength(0);

    // End is still the candidate's.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /end the interview/i }));
    });
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      callbacks().onDisconnect?.({ reason: "user" });
    });
    expect(report()).toEqual({ reason: "user", outcome: "finish", end: "user", elapsedSeconds: 115 });
  });

  it("sends the interviewer its clock in lines the candidate never hears: half, two minutes, one minute and time up, each once", async () => {
    await liveCall(300);

    tick(149_000);
    expect(sdk.sendContextualUpdate).not.toHaveBeenCalled();
    tick(2_000);
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(1);
    expect(sdk.sendContextualUpdate.mock.calls[0][0]).toMatch(/^\[time\] Half of the interview time has passed; about 2 minutes remain/);
    tick(30_000);
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(2);
    expect(sdk.sendContextualUpdate.mock.calls[1][0]).toMatch(/^\[time\] About two minutes remain/);

    // 75 s left, where the old wrap-up line went out: nothing now.
    tick(45_000);
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(2);
    tick(15_000);
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(3);
    expect(sdk.sendContextualUpdate.mock.calls[2][0]).toMatch(/^\[time\] About one minute remains\. This is not the end: keep asking/);
    expect(sdk.sendContextualUpdate.mock.calls[2][0]).toMatch(/Do not say goodbye/);

    tick(58_000);
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(3);
    tick(2_000);
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(4);
    expect(sdk.sendContextualUpdate.mock.calls[3][0]).toMatch(/^\[time\] The interview time is up\. Ask nothing new/);

    // Through the grace nothing more is sent.
    tick(50_000);
    expect(sdk.sendContextualUpdate).toHaveBeenCalledTimes(4);
  });

  it("leaves a first call's end to the platform's limit (paid length plus the grace), and only steps in well after it", async () => {
    await liveCall(300);

    // Past the paid length and the 60 s of grace: the platform is cutting the call.
    tick(370_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    tick(6_000);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "user" });
    });
    expect(report()).toMatchObject({ reason: "user", outcome: "finish", end: "room" });
  });

  it("hangs up a resumed call by itself past its paid length and the grace, and reports it as finished", async () => {
    await liveCall(90, { resumed: true });

    // 0:00 came and went: the grace is the candidate's last answer and the goodbye.
    tick(92_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    tick(60_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    tick(2_000);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "user" });
    });
    // The room's own hang-up, not the candidate's End.
    expect(report()).toMatchObject({ reason: "user", outcome: "finish", end: "room" });
    expect(report()).not.toHaveProperty("endDetail");
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
    expect(screen.getByRole("status").textContent).toBe("Último minuto. El entrevistador sigue preguntando hasta que se cumpla el tiempo.");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByLabelText("Tiempo restante").textContent).toBe("Tiempo cumplido · cerrando…");
    expect(screen.getByRole("status").textContent).toBe("Se cumplió el tiempo. Termina tu respuesta; el entrevistador se despedirá y cerrará la llamada.");
    expect(sdk.endSession).not.toHaveBeenCalled();
  });
});

describe("InterviewAgent: only the room hangs up", () => {
  it("refuses time_up before 0:00: the answer names the time left, the call stays live and nothing is reported", async () => {
    await liveCall(300);
    await answer();
    tick(120_000);

    const result = askToEnd("time_up");

    expect(result).toMatch(/^REFUSED: the call continues\./);
    expect(result).toContain("3 min 0 s remain");
    expect(result).toMatch(/Do not say goodbye/);
    expect(result).toMatch(/ask your next interview question now\.$/);
    expect(sdk.endSession).not.toHaveBeenCalled();
    expect(endedReports()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /end the interview/i })).toBeTruthy();
    expect(clock()).toBe("3:00");
    // For support: the reason and the clocks, never what was said.
    expect(console.info).toHaveBeenCalledWith("[CVision][room] end_interview reason=time_up at=120s left=180s: refused");
  });

  it("an answer that ends at 3:54 of a five-minute trial does not lead to a goodbye: the room refuses and the interview goes on", async () => {
    await liveCall(300, { source: "trial" });
    await say("agent", "Tell me about a project you led, and what your part in it was.");
    tick(234_000);
    await say("user", "I led the move of our billing jobs to a queue, and wrote most of the workers.");

    const result = askToEnd("time_up");

    expect(result).toMatch(/^REFUSED/);
    expect(result).toContain("1 min 6 s remain");
    // No goodbye state, no hang-up, then or later.
    tick(20_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    expect(endedReports()).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
    expect(clock()).toBe("0:46");
    expect(screen.getByRole("status").textContent).toBe("Last minute. The interviewer keeps asking until the time is up.");
    expect(screen.getByRole("button", { name: /end the interview/i })).toBeTruthy();
  });

  it("reads a call with no known reason as time_up: refused while paid time is left", async () => {
    await liveCall(300);
    tick(60_000);

    expect(askToEnd(undefined)).toMatch(/^REFUSED: the call continues\. The interview time is not up/);
    expect(askToEnd("the candidate seems done")).toMatch(/^REFUSED/);
    expect(sdk.endSession).not.toHaveBeenCalled();
  });

  it("allows time_up at 0:00, waits for the goodbye to be spoken, then hangs up and reports the interviewer's end without calling it a Finish", async () => {
    await liveCall(300);
    await answer();
    tick(300_000);
    expect(clock()).toBe("Time's up · closing…");

    // Allowed: the room does not answer, it waits for the goodbye that came with the call.
    const answers = askToEndAllowed("time_up");
    expect(sdk.endSession).not.toHaveBeenCalled();

    // The goodbye is being spoken: the room waits, however long the sentence.
    act(() => sdk.setMode("speaking"));
    await say("agent", GOODBYE);
    tick(5_000);
    expect(sdk.endSession).not.toHaveBeenCalled();

    // Quiet for a moment is a breath, not the end of the goodbye.
    act(() => sdk.setMode("listening"));
    tick(1_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    expect(answers).toEqual([]);
    tick(1_200);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Ending the interview")).toBeTruthy();
    await settled();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatch(/^ALLOWED/);

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "user" });
    });
    expect(report()).toEqual({ reason: "user", end: "interviewer", endDetail: "time_up", elapsedSeconds: 307.2 });
    expect(report()).not.toHaveProperty("outcome");
    expect(endedReports()).toHaveLength(1);
    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
  });

  it("a second breath in the goodbye starts the wait again", async () => {
    await liveCall(300);
    await answer();
    tick(300_000);
    askToEndAllowed("time_up");

    act(() => sdk.setMode("speaking"));
    tick(2_000);
    act(() => sdk.setMode("listening"));
    tick(1_000);
    act(() => sdk.setMode("speaking"));
    tick(2_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    act(() => sdk.setMode("listening"));
    tick(1_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    tick(1_200);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
  });

  it("allowed, and nothing is heard: after three seconds the room answers so the goodbye can be said, and after eight it hangs up anyway", async () => {
    await liveCall(300);
    await answer();
    tick(301_000);

    const answers = askToEndAllowed("time_up");
    tick(2_500);
    await settled();
    expect(answers).toEqual([]);
    // The interviewer called the tool without the goodbye, or is waiting for the answer before it speaks.
    tick(1_000);
    await settled();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatch(/^ALLOWED: the room hangs up when you finish speaking\. Say the goodbye now/);
    expect(sdk.endSession).not.toHaveBeenCalled();
    tick(3_500);
    expect(sdk.endSession).not.toHaveBeenCalled();
    tick(1_500);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
    await settled();
    expect(answers).toHaveLength(1);
  });

  it("the goodbye already said when the call arrives: hangs up once the interviewer has been quiet, with no wait for another", async () => {
    await liveCall(300);
    await answer();
    tick(300_000);
    await say("agent", GOODBYE);

    const answers = askToEndAllowed("time_up");
    tick(1_500);
    expect(sdk.endSession).not.toHaveBeenCalled();
    tick(800);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
    await settled();
    expect(answers).toEqual(["ALLOWED: the room is ending the call now. Say nothing more."]);
  });

  it("allowed, and the interviewer never stops speaking: hangs up after thirty seconds at most", async () => {
    await liveCall(300);
    await answer();
    tick(300_000);
    askToEndAllowed("time_up");
    act(() => sdk.setMode("speaking"));

    tick(29_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    tick(1_500);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
  });

  it("holds a second call with the first and hangs up once", async () => {
    await liveCall(300);
    await answer();
    tick(300_000);

    askToEndAllowed("time_up");
    tick(3_500);
    const second = askToEndAllowed("time_up");
    // The wait counts from the first call.
    tick(5_000);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
    tick(10_000);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
    await settled();
    expect(second).toHaveLength(1);
  });

  it("refuses candidate_confirmed when the candidate was never asked, and says what to ask", async () => {
    await liveCall(300);
    await say("agent", "How did you split the work on that migration?");
    await say("user", "I think that's it.");
    tick(100_000);

    const result = askToEnd("candidate_confirmed");

    expect(result).toMatch(/^REFUSED: the call continues\./);
    expect(result).toContain('"Do you want to end the interview now?"');
    expect(sdk.endSession).not.toHaveBeenCalled();
    expect(screen.queryByText("The interviewer is saying goodbye.")).toBeNull();
  });

  it("refuses candidate_confirmed when the candidate answered no", async () => {
    await liveCall(300);
    await say("user", "Can we stop here?");
    await say("agent", "Do you want to end the interview now?");
    await say("user", "No, let's keep going.");

    expect(askToEnd("candidate_confirmed")).toMatch(/^REFUSED/);
    expect(sdk.endSession).not.toHaveBeenCalled();
  });

  it("allows candidate_confirmed after the question and a yes, with paid time left: goodbye notice, the clock still counting, the end reported as confirmed", async () => {
    await liveCall(300);
    await say("agent", "How did you split the work on that migration?");
    await say("user", "Sorry, I'd rather stop here.");
    await say("agent", "Do you want to end the interview now?");
    await say("user", "Yes, please.");
    tick(100_000);

    askToEndAllowed("candidate_confirmed");
    expect(screen.getByRole("status").textContent).toBe("The interviewer is saying goodbye.");
    // The time was not up: the clock says what is left, not "time's up".
    expect(clock()).toBe("3:20");
    expect(console.info).toHaveBeenCalledWith("[CVision][room] end_interview reason=candidate_confirmed at=100s left=200s: allowed (confirmed)");

    act(() => sdk.setMode("speaking"));
    tick(4_000);
    act(() => sdk.setMode("listening"));
    tick(1_000);
    tick(1_200);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "user" });
    });
    expect(report()).toEqual({ reason: "user", end: "interviewer", endDetail: "confirmed", elapsedSeconds: 106.2 });
    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
  });

  it("after the time-up line, a goodbye said without asking the room is the same end", async () => {
    await liveCall(300);
    await answer();
    tick(300_000);

    act(() => sdk.setMode("speaking"));
    await say("agent", GOODBYE);
    tick(3_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    act(() => sdk.setMode("listening"));
    tick(1_000);
    tick(1_200);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "user" });
    });
    expect(report()).toMatchObject({ end: "interviewer", endDetail: "time_up" });
    expect(report()).not.toHaveProperty("outcome");
  });

  it("before the time-up line, a goodbye said without asking the room ends nothing", async () => {
    await liveCall(300);
    await answer();
    tick(235_000);

    act(() => sdk.setMode("speaking"));
    await say("agent", GOODBYE);
    act(() => sdk.setMode("listening"));
    tick(20_000);

    expect(sdk.endSession).not.toHaveBeenCalled();
    expect(endedReports()).toHaveLength(0);
    expect(clock()).toBe("0:45");
  });

  it("the candidate's End during the goodbye is still the candidate's End", async () => {
    await liveCall(300);
    await answer();
    tick(300_000);
    askToEndAllowed("time_up");
    act(() => sdk.setMode("speaking"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /end the interview/i }));
    });
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      callbacks().onDisconnect?.({ reason: "user" });
    });
    expect(report()).toMatchObject({ outcome: "finish", end: "user" });
    expect(report()).not.toHaveProperty("endDetail");
    // The room's own wait does not hang up a second time.
    tick(40_000);
    expect(sdk.endSession).toHaveBeenCalledTimes(1);
  });

  it("an end the room allowed does not carry over to the next call when the connection drops first", async () => {
    await liveCall(300);
    await say("user", "Can we stop here?");
    await say("agent", "Do you want to end the interview now?");
    await say("user", "Yes.");
    tick(100_000);
    const answers = askToEndAllowed("candidate_confirmed");
    // The connection drops before the goodbye: a drop, not the interviewer's end.
    await act(async () => {
      callbacks().onDisconnect?.({ reason: "error", message: "x", context: { type: "close" } });
    });
    expect(report()).toMatchObject({ outcome: "drop", end: "disconnect" });
    expect(report()).not.toHaveProperty("endDetail");
    // The held call is let go with the call.
    await settled();
    expect(answers).toHaveLength(1);

    respond({ ok: true, data: { ...SESSION, maxDurationSeconds: 200, resumed: true } });
    await clickStart();
    await act(async () => {
      callbacks().onConnect?.({ conversationId: "conv_2" });
    });
    tick(40_000);
    expect(sdk.endSession).not.toHaveBeenCalled();
    expect(screen.queryByText("The interviewer is saying goodbye.")).toBeNull();
    expect(clock()).toBe("2:40");
  });

  it("gives the voice e2e its hooks only with dev tools on", async () => {
    const hooks = () => (window as unknown as { __cvisionRoom?: { note: (text: string) => void; say: (text: string) => void } }).__cvisionRoom;
    const view = render(<InterviewAgent {...props} />);
    expect(hooks()).toBeUndefined();
    view.unmount();

    render(<InterviewAgent {...props} devHooks />);
    hooks()?.note("[time] The interview time is up.");
    hooks()?.say("That is all I have.");
    expect(sdk.sendContextualUpdate).toHaveBeenCalledWith("[time] The interview time is up.");
    expect(sdk.sendUserMessage).toHaveBeenCalledWith("That is all I have.");
    cleanup();
    expect(hooks()).toBeUndefined();
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
    expect(init).toMatchObject({ method: "POST", keepalive: true });
    expect(report()).toEqual({ reason: "user", outcome: "finish", end: "user", elapsedSeconds: 0 });
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
    expect(report()).toEqual({ reason: details.reason, end: details.reason === "agent" ? "disconnect" : "limit", elapsedSeconds: 0 });
  });

  it("when the platform ends the call with minutes left, keeps the time: Continue or Finish, nothing scored yet", async () => {
    await liveCall(300);
    await answer();
    tick(177_000);

    await act(async () => {
      callbacks().onDisconnect?.({ reason: "agent", context: { type: "close", reason: "agent disconnected" } });
    });

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("The interview ended early. You still have 2:03.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /finish and get feedback/i })).toBeTruthy();
    expect(report()).toEqual({ reason: "agent", outcome: "drop", end: "disconnect", elapsedSeconds: 177 });
    // Not the candidate's connection: all three are still there.
    expect(screen.getByText("Continue — 3 starts left")).toBeTruthy();
  });

  // A five-minute call that ends from the other side at this second, after these interviewer words.
  async function platformEndAt(seconds: number, lastWords: string) {
    await liveCall(300);
    await answer();
    tick(seconds * 1000);
    await say("agent", lastWords);
    await act(async () => {
      callbacks().onDisconnect?.({ reason: "agent", context: { type: "close", reason: "agent disconnected" } });
    });
  }

  it("an end from the other side with 65 s left is early even after a goodbye: only the room's own hang-up is the interviewer's end", async () => {
    await platformEndAt(235, GOODBYE);

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("The interview ended early. You still have 1:05.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy();
    expect(report()).toEqual({ reason: "agent", outcome: "drop", end: "disconnect", elapsedSeconds: 235 });
    expect(screen.getByText("Continue — 3 starts left")).toBeTruthy();
  });

  it("an end from the other side with 30 s or less left stands: nothing is worth resuming, the feedback page opens", async () => {
    await platformEndAt(272, "And how did you test the change?");

    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
    expect(report()).toEqual({ reason: "agent", end: "disconnect", elapsedSeconds: 272 });
  });

  it("an end from the other side during the grace stands", async () => {
    await platformEndAt(330, "Take your time.");

    expect(push).toHaveBeenCalledWith(`/interview/${INTERVIEW_ID}/feedback?ended=1`);
    expect(report()).toEqual({ reason: "agent", end: "disconnect", elapsedSeconds: 330 });
  });

  it("opens on the early-end panel, not on a dropped call, when the stored end was the interviewer's", () => {
    render(<InterviewAgent {...props} startCount={0} resume={{ usedSeconds: 235, resumable: true, early: true }} maxDurationSeconds={300} entry={{ kind: "continue" }} />);
    expect(screen.getByText("The interview ended early. You still have 1:05.")).toBeTruthy();
    expect(screen.queryByText(/Your call dropped at/)).toBeNull();
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
    expect(report()).toMatchObject({ reason: "error", outcome: "drop", end: "disconnect" });

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
    expect(init).toMatchObject({ keepalive: true });
    expect(report()).toMatchObject({ reason: "pagehide", outcome: "drop", end: "disconnect" });
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
    expect(report()).toMatchObject({ reason: "agent", end: "disconnect" });
    expect(report()).not.toHaveProperty("outcome");
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
    expect(endedReports()).toHaveLength(1);
    expect(report()).toMatchObject({ reason: "error", outcome: "drop", end: "disconnect" });

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
