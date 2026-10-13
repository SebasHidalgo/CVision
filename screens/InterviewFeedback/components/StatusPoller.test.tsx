// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StatusPoller from "./StatusPoller";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

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
    render(<StatusPoller interviewId={INTERVIEW_ID} seen={{ status: "IN_PROGRESS", hasFeedback: false, failureReason: null }} />);

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
    render(<StatusPoller interviewId={INTERVIEW_ID} seen={{ status: "IN_PROGRESS", hasFeedback: false, failureReason: null }} />);

    await advance(9_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The same answer again does not refresh twice; the clock restarted, so polls are 3 s apart again.
    await advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls.length).toBeGreaterThanOrEqual(12);
  });

  it("refreshes when the failure reason or the feedback presence changes", async () => {
    serve([ok(snapshot({ failureReason: "SESSION_LOST" }))]);
    render(<StatusPoller interviewId={INTERVIEW_ID} seen={{ status: "IN_PROGRESS", hasFeedback: false, failureReason: null }} />);
    await advance(3_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();
    refresh.mockClear();

    serve([ok(snapshot({ status: "COMPLETED", hasFeedback: true }))]);
    render(<StatusPoller interviewId={INTERVIEW_ID} seen={{ status: "COMPLETED", hasFeedback: false, failureReason: null }} />);
    await advance(3_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops on 401 or 404, and survives a failed poll", async () => {
    const calls = serve([() => new Response("<!doctype html>", { status: 404 })]);
    render(<StatusPoller interviewId={INTERVIEW_ID} seen={{ status: "IN_PROGRESS", hasFeedback: false, failureReason: null }} />);
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
    render(<StatusPoller interviewId={INTERVIEW_ID} seen={{ status: "FEEDBACK_PENDING", hasFeedback: false, failureReason: null }} />);
    await advance(6_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
