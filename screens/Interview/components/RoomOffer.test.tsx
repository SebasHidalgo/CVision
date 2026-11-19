// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import InterviewAgent, { type InterviewAgentProps } from "./InterviewAgent";
import { previewProps } from "../utils/previewStates";

/** The room around the offer, as the page renders it: the SDK and the router stubbed, nothing reaches the network. */
vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useConversationClientTool: () => {},
  useConversation: () => ({
    startSession: vi.fn(),
    endSession: vi.fn(),
    sendContextualUpdate: vi.fn(),
    sendUserMessage: vi.fn(),
    getInputVolume: () => 0,
    getOutputVolume: () => 0,
    mode: "listening",
    isSpeaking: false,
    isListening: true,
    status: "disconnected",
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const props: InterviewAgentProps = {
  interviewId: "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c",
  role: "Backend Engineer",
  company: "Northwind",
  candidateName: "Ana",
  analysisId: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
  attemptNumber: 2,
  startCount: 0,
  maxStarts: 3,
  maxDurationSeconds: 720,
  language: "en",
  resume: null,
  entry: { kind: "start", source: "period" },
  counts: { period: 3, periodLimit: 4, credits: 0 },
  offer: { prices: { pro: "US$15.00", pack: "US$9.00" }, proInterviewsPerMonth: 4, fullMinutes: 12, packCredits: 4, periodLimit: 4 },
};

const room = (state: Parameters<typeof previewProps>[0]) =>
  render(<InterviewAgent {...props} {...previewProps(state, { calls: [], turns: [] }, { fullSeconds: 720, trialSeconds: 300 })} />);

beforeAll(() => {
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

afterEach(cleanup);

describe("RoomOffer in the room: one status region at a time", () => {
  it.each(["purchase-waiting", "confirming", "stalled"] as const)("a purchase landing (%s) is the room's only status region", (state) => {
    vi.stubGlobal("fetch", vi.fn());
    const { container } = room(state);

    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0].getAttribute("data-offer")).toBe("purchase");
    // The footer has nothing to say while the room is blocked: no empty second region beside the panel's.
    expect(container.querySelector('[data-room-part="notice"]')?.hasAttribute("role")).toBe(false);
  });

  it("an offer with nothing landing has no status region of its own", () => {
    vi.stubGlobal("fetch", vi.fn());
    room("needs-pro");
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("a room that can start keeps the footer as its one status region", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { container } = room("ready");
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0]).toBe(container.querySelector('[data-room-part="notice"]'));
  });
});
