import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { RESUME_WINDOW_MS } from "@/lib/voice/segments";
import { finalizeLapsedInterviews, finalizeResumableInterview, recordCallOutcome, UNRECORDED_CALL_GIVE_UP_MS } from "./interviewResume";

vi.mock("@/lib/prisma", () => ({
  default: { interview: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() } },
}));

const findUnique = vi.mocked(prisma.interview.findUnique);
const findMany = vi.mocked(prisma.interview.findMany);
const updateMany = vi.mocked(prisma.interview.updateMany);

const NOW = new Date("2026-11-11T12:20:00Z");
const ENDED = new Date("2026-11-11T12:03:12Z");

const spoken = [
  { role: "agent", message: "How did you test the cutover?", time_in_call_secs: 0 },
  { role: "user", message: "With a shadow write.", time_in_call_secs: 6 },
];
const earlier = { conversationId: "conv_a", turns: [{ role: "user", message: "I led the migration.", time_in_call_secs: 4 }], durationSeconds: 100, startTimeSeconds: 1 };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "int_1",
  status: "IN_PROGRESS",
  conversationId: "conv_b",
  transcript: spoken,
  transcriptSource: "elevenlabs",
  segments: null,
  durationSeconds: 192,
  endedAt: ENDED,
  lastSessionAt: new Date("2026-11-11T12:00:00Z"),
  resumableUntil: new Date(ENDED.getTime() + RESUME_WINDOW_MS),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
  findMany.mockResolvedValue([]);
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("finalizeResumableInterview", () => {
  it("scores a single dropped call as it stands", async () => {
    findUnique.mockResolvedValue(row() as never);

    expect(await finalizeResumableInterview("int_1")).toBe("finalized");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "int_1", status: "IN_PROGRESS", conversationId: "conv_b" },
      data: expect.objectContaining({ status: "FEEDBACK_PENDING", transcript: spoken, durationSeconds: 192, resumableUntil: null, failureReason: null }),
    });
  });

  it("merges the earlier calls with the latest, in order, and sums the time", async () => {
    findUnique.mockResolvedValue(row({ segments: [earlier] }) as never);

    expect(await finalizeResumableInterview("int_1")).toBe("finalized");
    const { data } = updateMany.mock.calls[0][0] as { data: { transcript: Array<{ role: string; message: string }>; durationSeconds: number; segments: unknown[] } };
    expect(data.transcript.map((turn) => turn.role)).toEqual(["user", "system", "agent", "user"]);
    expect(data.transcript[1].message).toBe("[call resumed]");
    expect(data.durationSeconds).toBe(292);
    expect(data.segments).toHaveLength(2);
  });

  it("waits for the latest call's record unless told it is not coming", async () => {
    findUnique.mockResolvedValue(row({ transcript: null, transcriptSource: null, segments: [earlier] }) as never);
    expect(await finalizeResumableInterview("int_1")).toBe("not-ready");
    expect(updateMany).not.toHaveBeenCalled();

    expect(await finalizeResumableInterview("int_1", { latestMissing: true })).toBe("finalized");
    expect((updateMany.mock.calls[0][0] as { data: { durationSeconds: number } }).data.durationSeconds).toBe(100);
  });

  it("has nothing to score when nobody ever spoke, and closes the window so the ordinary paths apply", async () => {
    findUnique.mockResolvedValue(row({ transcript: [{ role: "agent", message: "Hi.", time_in_call_secs: 0 }] }) as never);

    expect(await finalizeResumableInterview("int_1")).toBe("nothing-to-score");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "int_1", status: "IN_PROGRESS", conversationId: "conv_b" },
      data: { resumableUntil: null, finishRequestedAt: null },
    });
  });

  it("loses to a session issued in between: the candidate came back", async () => {
    findUnique.mockResolvedValue(row() as never);
    updateMany.mockResolvedValue({ count: 0 });
    expect(await finalizeResumableInterview("int_1")).toBe("not-found");
  });

  it("leaves an interview that is not in progress alone", async () => {
    findUnique.mockResolvedValue(row({ status: "COMPLETED" }) as never);
    expect(await finalizeResumableInterview("int_1")).toBe("not-found");
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("finalizeLapsedInterviews: the lazy sweep", () => {
  it("looks for the user's interviews whose window is over, and scores those whose latest call is stored", async () => {
    findMany.mockResolvedValue([{ id: "int_1", transcriptSource: "elevenlabs", lastSessionAt: new Date("2026-11-11T12:00:00Z") }] as never);
    findUnique.mockResolvedValue(row() as never);

    expect(await finalizeLapsedInterviews("user_1", NOW)).toEqual(["int_1"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "user_1", status: "IN_PROGRESS", resumableUntil: { lte: NOW } },
      select: { id: true, transcriptSource: true, lastSessionAt: true },
    });
  });

  it("leaves a latest call still waiting for its record to the reconcile, until it is long overdue", async () => {
    const recent = new Date(NOW.getTime() - UNRECORDED_CALL_GIVE_UP_MS + 60_000);
    findMany.mockResolvedValue([{ id: "int_1", transcriptSource: null, lastSessionAt: recent }] as never);
    expect(await finalizeLapsedInterviews("user_1", NOW)).toEqual([]);
    expect(findUnique).not.toHaveBeenCalled();

    const overdue = new Date(NOW.getTime() - UNRECORDED_CALL_GIVE_UP_MS - 60_000);
    findMany.mockResolvedValue([{ id: "int_1", transcriptSource: null, lastSessionAt: overdue }] as never);
    findUnique.mockResolvedValue(row({ transcript: null, transcriptSource: null, segments: [earlier] }) as never);
    expect(await finalizeLapsedInterviews("user_1", NOW)).toEqual(["int_1"]);
  });
});

describe("recordCallOutcome: what the room says about the end of a call", () => {
  it("a drop opens the ten-minute window, once, and decides nothing", async () => {
    expect(await recordCallOutcome({ interviewId: "int_1", userId: "user_1", outcome: "drop", now: NOW })).toEqual({ finalized: false });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "int_1", userId: "user_1", status: "IN_PROGRESS", resumableUntil: null, finishRequestedAt: null },
      data: { resumableUntil: new Date(NOW.getTime() + 10 * 60_000) },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("Finish is recorded and applied at once when the latest call is stored", async () => {
    findUnique.mockResolvedValue(row() as never);
    expect(await recordCallOutcome({ interviewId: "int_1", userId: "user_1", outcome: "finish", now: NOW })).toEqual({ finalized: true });
    expect(updateMany.mock.calls[0][0]).toEqual({ where: { id: "int_1", userId: "user_1", status: "IN_PROGRESS" }, data: { finishRequestedAt: NOW } });
  });

  it("Finish before the call's record arrives only leaves the request: the record closes the interview", async () => {
    findUnique.mockResolvedValue(row({ transcript: null, transcriptSource: null }) as never);
    expect(await recordCallOutcome({ interviewId: "int_1", userId: "user_1", outcome: "finish", now: NOW })).toEqual({ finalized: false });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an interview that is not the caller's or not in progress", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await recordCallOutcome({ interviewId: "int_x", userId: "user_1", outcome: "finish", now: NOW })).toEqual({ finalized: false });
    expect(findUnique).not.toHaveBeenCalled();
  });
});
