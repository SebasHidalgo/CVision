/**
 * Applies `BUCKET_SETTINGS` (private, PDF only, size-capped) to the CV bucket
 * and verifies the result: the old public URL of one stored CV must be
 * refused and a signed URL for it must serve the PDF. Also lists the
 * row-level policies on `storage.objects`, which the Storage API does not
 * expose, straight from Postgres.
 *
 *   npm run storage:bucket            apply and verify
 *   npm run storage:bucket -- --check verify only, change nothing
 *
 * Idempotent: applying the same settings twice is a no-op. Never prints a key.
 */
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  applyBucketSettings,
  BUCKET_SETTINGS,
  createSignedReadUrl,
  getBucketSettings,
  RESUME_BUCKET,
} from "@/lib/supabase/server";

const { values: args } = parseArgs({ options: { check: { type: "boolean", default: false } } });
const prisma = new PrismaClient();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");

  const before = await getBucketSettings();
  console.log(`bucket ${RESUME_BUCKET} before: ${JSON.stringify(before)}`);

  if (!args.check) {
    await applyBucketSettings(BUCKET_SETTINGS);
    console.log(`bucket ${RESUME_BUCKET} after:  ${JSON.stringify(await getBucketSettings())}`);
  }

  // One stored CV, to try both routes against.
  const [row] = await prisma.$queryRaw<{ resumeKey: string }[]>`
    SELECT "resumeKey" FROM "ResumeAnalysis" ORDER BY "createdAt" DESC LIMIT 1`;
  if (!row) {
    console.log("no ResumeAnalysis row to verify against");
  } else {
    const publicUrl = `${url}/storage/v1/object/public/${RESUME_BUCKET}/${row.resumeKey}`;
    const viaPublic = await fetch(publicUrl);
    console.log(`old public URL: HTTP ${viaPublic.status}`);

    const signed = await createSignedReadUrl(row.resumeKey);
    if (!signed) {
      console.log("signed URL: object not found");
    } else {
      const viaSigned = await fetch(signed);
      const head = new Uint8Array(await viaSigned.arrayBuffer()).slice(0, 5);
      console.log(
        `signed URL: HTTP ${viaSigned.status} ${viaSigned.headers.get("content-type")} starts with ${JSON.stringify(new TextDecoder().decode(head))}`,
      );
    }
  }

  const policies = await prisma.$queryRaw<{ policyname: string; roles: string[]; cmd: string; qual: string | null; with_check: string | null }[]>`
    SELECT policyname, roles::text[] AS roles, cmd, qual, with_check
    FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    ORDER BY policyname`;
  console.log(`policies on storage.objects: ${policies.length}`);
  for (const policy of policies) {
    console.log(
      `  ${policy.policyname}: ${policy.cmd} for ${policy.roles.join(", ")} using ${policy.qual ?? "-"} with check ${policy.with_check ?? "-"}`,
    );
  }
  if (policies.some((policy) => policy.roles.includes("public") || policy.roles.includes("anon"))) {
    console.log(
      "WARNING: a policy grants the public/anon role access to storage.objects. The service role does not need any policy; drop these in the dashboard (Storage > Policies).",
    );
  }
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
