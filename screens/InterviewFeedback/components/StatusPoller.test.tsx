// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_CEILING_MS } from "../utils/pollDelay";
import StatusPoller from "./StatusPoller";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const ATTEMPTS_HREF = "/resume/analysis/9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  status: "IN_PROGRESS",
  hasFeedback: false,
  startCount: 1,
  failureReason: null,
  ...overrides,
});

/** The status endpoint, answering from a queue; the last answer repeats. */
function serve(answers: (() => Response)[]) {
  const calls: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls.push(Date.now());
      const next = answers.length > 1 ? answers.shift()! : answers[0];
      return next();
    }),
  );
  return calls;
}

const ok = (body: unknown) => () => Response.json({ ok: true, data: body });

function mount(seen: { status: string; hasFeedback: boolean; failureReason: string | null }) {
  return render(
    <StatusPoller interviewId={INTERVIEW_ID} seen={seen} attemptsHref={ATTEMPTS_HREF}>
      <p>Saving your interview.</p>
    </StatusPoller>,
  );
}

const waiting = { status: "IN_PROGRESS", hasFeedback: false, failureReason: null };

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StatusPoller", () => {
  it("polls with backoff and never re-renders while the answer is the same", async () => {
    const calls = serve([ok(snapshot())]);
    const t0 = Date.now();
    mount(waiting);

    expect(screen.getByText("Saving your interview.")).toBeTruthy();
    await advance(60_000);

    // 3 s apart for 30 s (10 polls), then 5 s apart (6 more by the minute).
    expect(calls).toHaveLength(16);
    expect(calls.slice(0, 3).map((t) => t - t0)).toEqual([3_000, 6_000, 9_000]);
    expect(calls.slice(10, 12).map((t) => t - t0)).toEqual([35_000, 40_000]);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/interview/${INTERVIEW_ID}/status`);
  });

  it("refreshes the page once when the status changes, then keeps polling from a fresh clock", async () => {
    const calls = serve([ok(snapshot()), ok(snapshot()), ok(snapshot({ status: "FEEDBACK_PENDING" }))]);
    mount(waiting);

    await advance(9_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The same answer again does not refresh twice; the clock restarted, so polls are 3 s apart again.
    await advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls.length).toBeGreaterThanOrEqual(12);
  });

  it("refreshes when the failure reason or the feedback presence changes", async () => {
    serve([ok(snapshot({ failureReason: "SESSION_LOST" }))]);
    mount(waiting);
    await advance(3_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();
    refresh.mockClear();

    serve([ok(snapshot({ status: "COMPLETED", hasFeedback: true }))]);
    mount({ status: "COMPLETED", hasFeedback: false, failureReason: null });
    await advance(3_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops on 401 or 404, and survives a failed poll", async () => {
    const calls = serve([() => new Response("<!doctype html>", { status: 404 })]);
    mount(waiting);
    await advance(30_000);
    expect(calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    cleanup();

    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (first) {
          first = false;
          throw new TypeError("Failed to fetch");
        }
        return Response.json({ ok: true, data: snapshot({ status: "GENERATING" }) });
      }),
    );
    mount({ status: "FEEDBACK_PENDING", hasFeedback: false, failureReason: null });
    await advance(6_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops at the ceiling and replaces the waiting copy with the stalled notice and the attempts link", async () => {
    const calls = serve([ok(snapshot())]);
    mount(waiting);

    await advance(POLL_CEILING_MS - 1_000);
    expect(screen.getByText("Saving your interview.")).toBeTruthy();

    // The last poll fires at the ceiling itself; nothing after, however long the tab stays open.
    await advance(1_000);
    const atCeiling = calls.length;
    await advance(POLL_CEILING_MS);
    expect(calls.length).toBe(atCeiling);
    // 10 fast, 18 medium, then one every 10 s for the rest of the hour.
    expect(atCeiling).toBe(10 + 18 + (POLL_CEILING_MS - 120_000) / 10_000);
    expect(screen.queryByText("Saving your interview.")).toBeNull();
    expect(screen.getByText(/taking longer than expected/)).toBeTruthy();
    expect(screen.getByText(/reload to check again/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /every attempt/i }).getAttribute("href")).toBe(ATTEMPTS_HREF);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("counts the ceiling from the mount, not from the last change", async () => {
    serve([ok(snapshot()), ok(snapshot({ status: "FEEDBACK_PENDING" }))]);
    mount(waiting);

    await advance(POLL_CEILING_MS - 10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/taking longer/)).toBeNull();

    await advance(20_000);
    expect(screen.getByText(/taking longer/)).toBeTruthy();
  });
});
