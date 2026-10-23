/**
 * The CV bucket as the code says it should be: private, PDF only, capped
 * at MAX_RESUME_BYTES (`BUCKET_SETTINGS` in lib/supabase/server.ts), with
 * no policy on storage.objects for anon or public. Creates the bucket when
 * the project has none (a production project's first run), corrects it
 * when it differs, and verifies: the settings, the policies, and, when a
 * stored CV exists, that its old public URL is refused and a signed URL
 * serves it.
 *
 *   npm run storage:setup            create or correct, then verify
 *   npm run storage:setup -- --check verify only; exit 1 when anything differs
 *
 * Idempotent. Policies on storage.objects belong to supabase_storage_admin
 * and are not touched here: an offending one is named with the dashboard
 * path. Never prints a key.
 */
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  bucketMatches,
  BUCKET_SETTINGS,
  createSignedReadUrl,
  ensureBucket,
  findBucketSettings,
  RESUME_BUCKET,
} from "@/lib/supabase/server";

const { values: args } = parseArgs({ options: { check: { type: "boolean", default: false } } });
const prisma = new PrismaClient();

type Line = { ok: boolean; text: string };

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  const lines: Line[] = [];

  const before = await findBucketSettings();
  console.log(`bucket ${RESUME_BUCKET} before: ${before ? JSON.stringify(before) : "(missing)"}`);
  if (args.check) {
    lines.push({ ok: bucketMatches(before), text: before ? (bucketMatches(before) ? "bucket settings as expected" : `bucket settings differ from ${JSON.stringify(BUCKET_SETTINGS)}: run npm run storage:setup`) : "bucket missing: run npm run storage:setup" });
  } else {
    const outcome = await ensureBucket();
    const after = await findBucketSettings();
    console.log(`bucket ${RESUME_BUCKET} ${outcome}: ${JSON.stringify(after)}`);
    lines.push({ ok: bucketMatches(after), text: `bucket ${outcome}` });
  }

  // One stored CV, to try both routes against; a fresh project has none.
  const [row] = await prisma.$queryRaw<{ resumeKey: string }[]>`
    SELECT "resumeKey" FROM "ResumeAnalysis" ORDER BY "createdAt" DESC LIMIT 1`;
  if (!row) {
    lines.push({ ok: true, text: "no stored CV to probe (fine for a new project)" });
  } else if (bucketMatches(await findBucketSettings())) {
    const viaPublic = await fetch(`${url}/storage/v1/object/public/${RESUME_BUCKET}/${row.resumeKey}`);
    lines.push({ ok: viaPublic.status === 400 || viaPublic.status === 404, text: `old public URL answers HTTP ${viaPublic.status} (must be refused)` });
    const signed = await createSignedReadUrl(row.resumeKey);
    if (!signed) {
      lines.push({ ok: true, text: "signed URL: the latest row's object is gone (the collector's business, not the bucket's)" });
    } else {
      const viaSigned = await fetch(signed);
      const head = new Uint8Array(await viaSigned.arrayBuffer()).slice(0, 5);
      const isPdf = new TextDecoder().decode(head) === "%PDF-";
      lines.push({ ok: viaSigned.status === 200 && isPdf, text: `signed URL answers HTTP ${viaSigned.status}, ${isPdf ? "a PDF" : "not a PDF"}` });
    }
  }

  const policies = await prisma.$queryRaw<{ policyname: string; roles: string[]; cmd: string }[]>`
    SELECT policyname, roles::text[] AS roles, cmd
    FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    ORDER BY policyname`;
  const open = policies.filter((policy) => policy.roles.includes("public") || policy.roles.includes("anon") || policy.roles.includes("authenticated"));
  lines.push({
    ok: open.length === 0,
    text: open.length
      ? `${open.length} policy(ies) on storage.objects for anon/authenticated/public: ${open.map((policy) => `${policy.policyname} (${policy.cmd} for ${policy.roles.join(", ")})`).join("; ")}. The service role needs none; drop them at Storage > Policies > ${RESUME_BUCKET}.`
      : `${policies.length} policy(ies) on storage.objects, none for anon, authenticated or public`,
  });

  console.log("");
  for (const line of lines) console.log(`${line.ok ? "PASS" : "FAIL"}  ${line.text}`);
  const failed = lines.filter((line) => !line.ok).length;
  if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(`\nbucket ${RESUME_BUCKET} as expected`);
  }
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
