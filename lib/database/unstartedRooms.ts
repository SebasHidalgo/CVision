import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { handleError } from "@/lib/error/handleError";

/**
 * The sweep of interview rooms that never started (lib/interviewStatus.ts: no voice session was ever issued). Such a
 * room holds nothing and is not listed or counted; its analysis's CTA reopens it while it lives. After three days it
 * is deleted by the daily cron (app/api/cron/storage-gc) or by hand (`npm run interviews:gc`). No session: it sweeps
 * every account.
 */

const LOG = "[CVision][rooms]";

/** How long a room that never started is kept. */
export const UNSTARTED_ROOM_TTL_MS = 3 * 24 * 60 * 60_000;

/**
 * Every guard of the sweep, for the one statement that deletes: a Start racing the sweep wins, because once its
 * reservation or its session write has landed the row no longer matches. Never a row that has a call (a session, a
 * conversation id, a start, a segment, a transcript), a reservation, any unit on the ledger named after it (`<id>` or
 * a re-reservation's `<id>#n`) or feedback.
 */
function unstartedRoomWhere(cutoff: Date): Prisma.Sql {
  return Prisma.sql`i."status" = 'SCHEDULED'
    AND cardinality(i."issuedConversationIds") = 0
    AND i."conversationId" IS NULL
    AND i."startCount" = 0
    AND i."startedAt" IS NULL
    AND i."lastSessionAt" IS NULL
    AND i."usageEventId" IS NULL
    AND i."transcript" IS NULL
    AND i."segments" IS NULL
    AND i."createdAt" < ${cutoff}
    AND NOT EXISTS (SELECT 1 FROM "InterviewFeedback" f WHERE f."interviewId" = i."id")
    AND NOT EXISTS (SELECT 1 FROM "UsageEvent" u WHERE u."refId" = i."id" OR u."refId" LIKE i."id" || '#%')`;
}

type UnstartedRoomsReport = {
  /** Rooms created before this instant were in reach. */
  cutoff: Date;
  /** Deleted, or, in a dry run, that would be. */
  rooms: number;
  deleted: boolean;
};

/**
 * Deletes (or, with `remove: false`, counts) the rooms that never started and are older than three days. One
 * statement, every guard in its WHERE; logs one line with the count.
 */
export async function sweepUnstartedRooms({ remove, now = new Date() }: { remove: boolean; now?: Date }): Promise<UnstartedRoomsReport> {
  try {
    const cutoff = new Date(now.getTime() - UNSTARTED_ROOM_TTL_MS);
    const where = unstartedRoomWhere(cutoff);

    if (!remove) {
      const [row] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM "Interview" AS i WHERE ${where}`;
      return { cutoff, rooms: row?.count ?? 0, deleted: false };
    }

    const rooms = await prisma.$executeRaw`DELETE FROM "Interview" AS i WHERE ${where}`;
    console.info(`${LOG} ${JSON.stringify({ sweep: "unstarted-rooms", olderThanHours: UNSTARTED_ROOM_TTL_MS / 3_600_000, deleted: rooms })}`);
    return { cutoff, rooms, deleted: true };
  } catch (error) {
    handleError(error, "Failed to sweep the interview rooms that never started");
  }
}
