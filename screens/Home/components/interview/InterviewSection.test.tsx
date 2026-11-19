// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_PARTS } from "@/components/interview/room/RoomView";
import { createI18n } from "@/lib/i18n/instance";
import { RESOURCES } from "@/lib/i18n/resources";
import { InterviewSection } from "./InterviewSection";
import { timelineFor } from "./talk";

/** A stand-in for HTMLAudioElement: records what was asked of it, plays nothing, requests nothing. */
class FakeAudio {
  static made: FakeAudio[] = [];
  static refuse = false;
  src = "";
  preload = "";
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 4;
  constructor() {
    FakeAudio.made.push(this);
  }
  play() {
    if (FakeAudio.refuse) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener() {}
  removeEventListener() {}
}

let reduced = false;

beforeEach(() => {
  FakeAudio.made = [];
  FakeAudio.refuse = false;
  reduced = false;
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe() {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") && reduced,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollTo = () => {};
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const soundButton = () => screen.getByRole("button", { name: "Sound" });
/** The room's parts in document order, as the shared view tags them. */
const roomParts = (root: ParentNode) => [...root.querySelectorAll("[data-room-part]")].map((el) => el.getAttribute("data-room-part"));

describe("InterviewSection", () => {
  it("requests no audio until the sound is turned on, then the reader's language's files", () => {
    const { container } = render(<InterviewSection />);
    expect(container.querySelector("audio, source")).toBeNull();
    expect(FakeAudio.made).toHaveLength(0);
    expect(soundButton().getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Play the excerpt" }));
    act(() => void vi.advanceTimersByTime(3000));
    expect(FakeAudio.made).toHaveLength(0);

    fireEvent.click(soundButton());
    expect(soundButton().getAttribute("aria-pressed")).toBe("true");
    expect(FakeAudio.made.map((a) => a.src)).toEqual(timelineFor("en").lines.map((_, i) => `/landing/voice/en/0${i + 1}.mp3`));
    // The excerpt was past the first line's start: the clock, not the click, cues it.
    act(() => void vi.advanceTimersByTime(200));
    expect(FakeAudio.made.filter((a) => !a.paused)).toHaveLength(1);

    fireEvent.click(soundButton());
    expect(soundButton().getAttribute("aria-pressed")).toBe("false");
    expect(FakeAudio.made.every((a) => a.paused)).toBe(true);
  });

  it("starts the first line inside the click when the sound is what starts the excerpt", () => {
    render(<InterviewSection />);
    fireEvent.click(soundButton());
    expect(FakeAudio.made[0].paused).toBe(false);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("goes on without sound when the browser refuses to play it", async () => {
    FakeAudio.refuse = true;
    render(<InterviewSection />);
    fireEvent.click(soundButton());
    await act(async () => {
      await Promise.resolve();
    });
    expect(soundButton().getAttribute("aria-pressed")).toBe("false");
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByRole("log").textContent).toContain("Hi Guillermo");
  });

  it("writes the conversation into the room as it plays, then opens the feedback", () => {
    render(<InterviewSection />);
    expect(screen.getByText("Ready when you are")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start the interview" }));
    const first = timelineFor("en").lines[0];
    act(() => void vi.advanceTimersByTime((first.start + 0.5) * 1000));
    expect(screen.getByText("Interviewer speaking")).toBeTruthy();
    expect(screen.getByRole("log").textContent).toContain("Hi Guillermo");

    fireEvent.click(screen.getByRole("button", { name: "End the interview" }));
    expect(screen.getByText("Interview ended")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /During/ }).getAttribute("aria-selected")).toBe("true");
    act(() => void vi.advanceTimersByTime(1500));
    expect(screen.getByRole("tab", { name: /After/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Communication Skills")).toBeTruthy();
  });

  it("is the app's room: the shared view's parts, in its order, before and during the call", () => {
    const { container } = render(<InterviewSection />);
    const room = container.querySelector('[data-room-part="frame"]')!;
    expect(room.getAttribute("data-variant")).toBe("replica");
    expect(roomParts(container)).toEqual(ROOM_PARTS.filter((part) => part !== "panel"));
    fireEvent.click(screen.getByRole("button", { name: "Start the interview" }));
    act(() => void vi.advanceTimersByTime(1000));
    expect(roomParts(container)).toEqual(ROOM_PARTS.filter((part) => part !== "panel" && part !== "facts"));
    // The interviewer opens: its turn by the app's rule, in its words and on its meter.
    const status = container.querySelector('[data-room-part="status"]')!;
    expect(status.getAttribute("data-turn")).toBe("interviewer");
    expect(container.querySelector('[data-meter="interviewer"]')!.getAttribute("data-floor")).toBe("has");
  });

  it("says whose turn it is the way the app does: the interviewer's through its question, then the candidate's", () => {
    render(<InterviewSection />);
    fireEvent.click(screen.getByRole("button", { name: "Start the interview" }));
    const [first, second] = timelineFor("en").lines;
    // Before the first word: the interviewer holds the turn.
    act(() => void vi.advanceTimersByTime(first.start * 500));
    expect(screen.getByText("Interviewer's turn")).toBeTruthy();
    // Just after the question ends, before the answer: still the interviewer's.
    act(() => void vi.advanceTimersByTime((first.start + first.seconds + 0.1 - first.start / 2) * 1000));
    expect(screen.getByText("Interviewer speaking")).toBeTruthy();
    act(() => void vi.advanceTimersByTime((second.start - (first.start + first.seconds) + 0.3) * 1000));
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  it("switches screens from the keyboard", () => {
    render(<InterviewSection />);
    const during = screen.getByRole("tab", { name: /During/ });
    fireEvent.keyDown(during, { key: "ArrowRight" });
    const after = screen.getByRole("tab", { name: /After/ });
    expect(after.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(after);
  });

  it("speaks, dates and prices in the reader's language", () => {
    const es = createI18n("es", RESOURCES.es);
    render(
      <I18nextProvider i18n={es}>
        <InterviewSection />
      </I18nextProvider>,
    );
    expect(screen.getByText("Te quedan 4 de 4 entrevistas de este período. Esta usa una.")).toBeTruthy();
    expect(screen.getByText("Feedback de la entrevista · 17 de noviembre de 2026")).toBeTruthy();
    expect(screen.getByText(/paquetes de 4 por USD 9/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sonido" }));
    expect(FakeAudio.made[0].src).toBe("/landing/voice/es/01.mp3");
  });

  it("shows the whole conversation at once under reduced motion", () => {
    reduced = true;
    render(<InterviewSection />);
    expect(screen.getByText("Interview ended")).toBeTruthy();
    expect(screen.getByRole("log").querySelectorAll("li")).toHaveLength(timelineFor("en").lines.length);
    expect(screen.getByRole("button", { name: "Play again" })).toBeTruthy();
    expect(FakeAudio.made).toHaveLength(0);
  });
});
