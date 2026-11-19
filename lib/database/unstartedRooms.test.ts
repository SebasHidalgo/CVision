import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { sweepUnstartedRooms, UNSTARTED_ROOM_TTL_MS } from "./unstartedRooms";

vi.mock("@/lib/prisma", () => ({ default: { $executeRaw: vi.fn(), $queryRaw: vi.fn() } }));

const NOW = new Date("2026-11-19T04:17:00.000Z");
const CUTOFF = new Date("2026-11-16T04:17:00.000Z");

/** The statement a tagged-template call sent, with its nested fragment composed: its text and its parameters. */
function sent(mock: ReturnType<typeof vi.fn>): { sql: string; values: unknown[] } {
  const [strings, ...values] = mock.mock.calls[0] as [readonly string[], ...unknown[]];
  const statement = Prisma.sql(strings, ...(values as Prisma.Sql[]));
  return { sql: statement.text.replace(/\s+/g, " "), values: statement.values };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$executeRaw).mockResolvedValue(2 as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 5 }] as never);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sweepUnstartedRooms", () => {
  it("deletes in one statement the rooms older than three days, and logs one line with the count", async () => {
    expect(UNSTARTED_ROOM_TTL_MS).toBe(3 * 24 * 3_600_000);
    expect(await sweepUnstartedRooms({ remove: true, now: NOW })).toEqual({ cutoff: CUTOFF, rooms: 2, deleted: true });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const { sql, values } = sent(vi.mocked(prisma.$executeRaw));
    expect(sql.startsWith('DELETE FROM "Interview" AS i WHERE ')).toBe(true);
    expect(sql).toContain('i."createdAt" < $1');
    expect(values).toEqual([CUTOFF]);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.info).mock.calls[0][0])).toBe('[CVision][rooms] {"sweep":"unstarted-rooms","olderThanHours":72,"deleted":2}');
  });

  // Each guard lives in the delete's own WHERE, so a Start that lands first makes the row stop matching.
  it.each([
    ["a room that started (any status past SCHEDULED)", `i."status" = 'SCHEDULED'`],
    ["a session ever issued", `cardinality(i."issuedConversationIds") = 0`],
    ["a conversation id", `i."conversationId" IS NULL`],
    ["a start counted", `i."startCount" = 0`],
    ["a call's start time", `i."startedAt" IS NULL`],
    ["a session time", `i."lastSessionAt" IS NULL`],
    ["a reservation", `i."usageEventId" IS NULL`],
    ["a transcript", `i."transcript" IS NULL`],
    ["a segment", `i."segments" IS NULL`],
    ["feedback", `NOT EXISTS (SELECT 1 FROM "InterviewFeedback" f WHERE f."interviewId" = i."id")`],
    ["a unit on the ledger named after it, or a re-reservation of it", `NOT EXISTS (SELECT 1 FROM "UsageEvent" u WHERE u."refId" = i."id" OR u."refId" LIKE i."id" || '#%')`],
  ])("never deletes a room with %s", async (_, guard) => {
    await sweepUnstartedRooms({ remove: true, now: NOW });
    expect(sent(vi.mocked(prisma.$executeRaw)).sql).toContain(guard);
  });

  it("joins every guard with AND: none of them can be skipped by another", async () => {
    await sweepUnstartedRooms({ remove: true, now: NOW });
    const where = sent(vi.mocked(prisma.$executeRaw)).sql.split(" WHERE ").slice(1).join(" WHERE ");
    expect(where).not.toMatch(/\)\s*OR\s|^\s*OR|\bOR\s+i\./);
    expect(where.match(/ AND /g)?.length).toBe(11);
  });

  it("a dry run counts with the very same WHERE and deletes nothing", async () => {
    expect(await sweepUnstartedRooms({ remove: false, now: NOW })).toEqual({ cutoff: CUTOFF, rooms: 5, deleted: false });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();

    const counted = sent(vi.mocked(prisma.$queryRaw));
    await sweepUnstartedRooms({ remove: true, now: NOW });
    const deleted = sent(vi.mocked(prisma.$executeRaw));
    expect(counted.sql.split(" WHERE ").slice(1).join(" WHERE ")).toBe(deleted.sql.split(" WHERE ").slice(1).join(" WHERE "));
    expect(counted.values).toEqual(deleted.values);
  });

  it("throws a typed error when the database fails", async () => {
    vi.mocked(prisma.$executeRaw).mockRejectedValue(new Error("db down"));
    await expect(sweepUnstartedRooms({ remove: true, now: NOW })).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});
