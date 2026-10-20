import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { RATE_LIMITS } from "@/lib/plans";
import { assertRateLimit, takeRateLimit } from "./rateLimit";

vi.mock("@/lib/prisma", () => ({
  default: { $executeRaw: vi.fn(), $queryRaw: vi.fn() },
}));

const NOW = new Date("2026-10-16T12:34:56Z");
const HOUR_START = new Date("2026-10-16T12:00:00Z");

/** The parameters the tagged template sent, in order. */
const paramsOf = (call: unknown[]) => call.slice(1);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$executeRaw).mockResolvedValue(0);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 1 }]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("takeRateLimit", () => {
  it("counts the hit in the fixed window of the action, keyed by user, and prunes the key's older windows", async () => {
    const decision = await takeRateLimit("user_1", "analysis", NOW);

    expect(decision).toEqual({ allowed: true, remaining: RATE_LIMITS.analysis.limit - 1 });
    expect(paramsOf(vi.mocked(prisma.$executeRaw).mock.calls[0])).toEqual(["user_1:analysis", HOUR_START]);
    expect(paramsOf(vi.mocked(prisma.$queryRaw).mock.calls[0])).toEqual(["user_1:analysis", HOUR_START]);
  });

  it("refuses past the limit with the seconds left in the window", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: RATE_LIMITS.analysis.limit + 1 }]);

    expect(await takeRateLimit("user_1", "analysis", NOW)).toEqual({
      allowed: false,
      retryAfterSeconds: 25 * 60 + 4, // until 13:00:00
    });
    await expect(assertRateLimit("user_1", "analysis", NOW)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      meta: { retryAfter: 25 * 60 + 4 },
    });
  });

  it("allows exactly the limit, not one more", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: RATE_LIMITS.interviewCreate.limit }]);
    expect(await takeRateLimit("user_1", "interviewCreate", NOW)).toEqual({ allowed: true, remaining: 0 });
  });

  it("rolls into a new window on the hour: a fresh window starts counting at one", async () => {
    const nextHour = new Date("2026-10-16T13:00:00Z");
    await takeRateLimit("user_1", "uploadUrl", nextHour);
    expect(paramsOf(vi.mocked(prisma.$queryRaw).mock.calls[0])).toEqual(["user_1:uploadUrl", nextHour]);
  });

  it("the status ceiling is a one-minute window", async () => {
    await takeRateLimit("user_1", "status", NOW);
    expect(paramsOf(vi.mocked(prisma.$queryRaw).mock.calls[0])).toEqual(["user_1:status", new Date("2026-10-16T12:34:00Z")]);
  });
});
