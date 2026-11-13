// One-time, for rows stored before M10-F: cuts every stored turn down to the fields the app reads (role, message, time_in_call_secs).
// Usage: npm run voice:trim-transcripts            (dry run: counts and sizes, never a turn's text)
//        npm run voice:trim-transcripts -- --write
// Refuses unless ALLOW_DEV_TOOLS=1 and PADDLE_ENV=sandbox. Idempotent: a second run finds nothing to cut.
import { parseArgs } from "node:util";
import { Prisma, PrismaClient } from "@prisma/client";
import { devToolsAllowed } from "@/lib/devTools";
import { trimStoredTurns } from "@/lib/voice/transcript";

const { values: args } = parseArgs({ options: { write: { type: "boolean" } } });

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null), "utf8");

type Tally = { rows: number; changed: number; before: number; after: number; turnsDropped: number; fields: Map<string, number> };

/** A stored array of turns, trimmed; `changed` when anything went. Not an array: left as it is. */
function trimColumn(value: unknown, tally: Tally): { value: unknown; changed: boolean } {
  if (!Array.isArray(value)) return { value, changed: false };
  const trimmed = trimStoredTurns(value);
  for (const turn of value) {
    if (typeof turn !== "object" || turn === null) continue;
    for (const key of Object.keys(turn)) if (!["role", "message", "time_in_call_secs"].includes(key)) tally.fields.set(key, (tally.fields.get(key) ?? 0) + 1);
  }
  tally.turnsDropped += value.length - trimmed.length;
  return { value: trimmed, changed: JSON.stringify(trimmed) !== JSON.stringify(value) };
}

async function main() {
  if (!devToolsAllowed()) throw new Error("refused: set ALLOW_DEV_TOOLS=1 and PADDLE_ENV=sandbox to use dev tools");
  const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL });
  const tally: Tally = { rows: 0, changed: 0, before: 0, after: 0, turnsDropped: 0, fields: new Map() };
  try {
    const rows = await db.interview.findMany({
      where: { OR: [{ transcript: { not: Prisma.DbNull } }, { segments: { not: Prisma.DbNull } }] },
      select: { id: true, transcript: true, segments: true },
    });
    for (const row of rows) {
      tally.rows += 1;
      tally.before += bytes(row.transcript) + bytes(row.segments);
      const transcript = trimColumn(row.transcript, tally);
      // Each earlier call of a resumed interview keeps its own turns.
      let segmentsChanged = false;
      const segments = Array.isArray(row.segments)
        ? row.segments.map((segment) => {
            if (typeof segment !== "object" || segment === null || Array.isArray(segment)) return segment;
            const turns = trimColumn((segment as { turns?: unknown }).turns, tally);
            segmentsChanged ||= turns.changed;
            return { ...segment, turns: turns.value };
          })
        : row.segments;
      tally.after += bytes(transcript.value) + bytes(segments);
      if (!transcript.changed && !segmentsChanged) continue;
      tally.changed += 1;
      if (args.write) {
        await db.interview.update({
          where: { id: row.id },
          data: {
            ...(transcript.changed ? { transcript: transcript.value as Prisma.InputJsonValue } : {}),
            ...(segmentsChanged ? { segments: segments as Prisma.InputJsonValue } : {}),
          },
        });
      }
    }
  } finally {
    await db.$disconnect();
  }

  console.log(`${tally.rows} interview(s) with stored turns; ${tally.changed} ${args.write ? "trimmed" : "would be trimmed (dry run: pass --write)"}`);
  console.log(`  stored size ${tally.before} -> ${tally.after} bytes; ${tally.turnsDropped} turn(s) without words (tool calls and results) dropped`);
  const dropped = [...tally.fields.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ${dropped.length} field name(s) dropped: ${dropped.map(([name, count]) => `${name} (${count})`).join(", ") || "none"}`);
}

// The script smoke test loads this module to prove its imports resolve; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`voice:trim-transcripts failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
