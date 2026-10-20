/**
 * One-off for M4: `ResumeAnalysis.resumeUrl` (a permanent public URL) becomes
 * `resumeKey` (the object's key in the bucket). The column is renamed in
 * place and every public URL is cut down to the key after
 * `/object/public/files-bucket/`; then each key is checked against the
 * bucket. A row whose object is missing is reported, never invented.
 *
 *   npx tsx --conditions=react-server --env-file-if-exists=.env scripts/storage/backfill-resume-keys.ts
 *
 * Run before `prisma db push` with the schema already renamed, so the push
 * finds the column in place and only drops what the schema dropped. Raw SQL
 * with no interpolation: the generated client still describes the old column
 * when this runs. Idempotent: a second run finds nothing to rename or cut.
 */
import { PrismaClient } from "@prisma/client";
import { isResumeKey } from "@/lib/supabase/resumeKey";
import { objectExists } from "@/lib/supabase/server";

const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ResumeAnalysis'
      AND column_name IN ('resumeUrl', 'resumeKey')`;
  const names = new Set(columns.map((column) => column.column_name));

  const [{ count: before }] = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "ResumeAnalysis"`;
  console.log(`rows before: ${before}`);

  if (names.has("resumeUrl") && !names.has("resumeKey")) {
    await prisma.$executeRaw`ALTER TABLE "ResumeAnalysis" RENAME COLUMN "resumeUrl" TO "resumeKey"`;
    console.log("renamed column resumeUrl -> resumeKey");
  } else if (names.has("resumeKey")) {
    console.log("column resumeKey already present; nothing to rename");
  } else {
    throw new Error("neither resumeUrl nor resumeKey exists on ResumeAnalysis");
  }

  const cut = await prisma.$executeRaw`
    UPDATE "ResumeAnalysis"
    SET "resumeKey" = substr(
      "resumeKey",
      strpos("resumeKey", '/object/public/files-bucket/') + length('/object/public/files-bucket/')
    )
    WHERE "resumeKey" LIKE '%/object/public/files-bucket/%'`;
  console.log(`public URLs cut down to keys: ${cut}`);

  const rows = await prisma.$queryRaw<{ id: string; resumeKey: string }[]>`
    SELECT id, "resumeKey" FROM "ResumeAnalysis" ORDER BY "createdAt"`;

  let missing = 0;
  let malformed = 0;
  for (const row of rows) {
    const shaped = isResumeKey(row.resumeKey);
    const exists = shaped ? await objectExists(row.resumeKey) : false;
    if (!shaped) malformed += 1;
    else if (!exists) missing += 1;
    const verdict = !shaped ? "MALFORMED" : exists ? "ok" : "MISSING IN BUCKET";
    console.log(`  ${row.id}  ${abbreviate(row.resumeKey)}  ${verdict}`);
  }

  const [{ count: after }] = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "ResumeAnalysis"`;
  console.log(`rows after: ${after}; keys verified in bucket: ${rows.length - missing - malformed}/${rows.length}; missing: ${missing}; malformed: ${malformed}`);
}

/** The user id is the owner's; shorten it so the log is readable. */
function abbreviate(key: string): string {
  return key.replace(/^cv\/([^/]{8})[^/]*\//, "cv/$1…/");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
