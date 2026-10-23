/**
 * Builds or repairs a database end to end, in the order the schema needs:
 * the migrations (prisma migrate deploy), then prisma/sql/bootstrap.sql
 * (everything Prisma does not model: RLS on every table, the revokes, the
 * bucket) over the direct connection, then the checks (db:check-rls and
 * storage:setup in verify mode), the SQL file's own report section, and
 * one summary.
 *
 *   npm run db:bootstrap
 *   npm run db:bootstrap -- --url postgresql://... --yes-i-mean-this-database
 *   npm run db:bootstrap -- --skip-storage      (a plain Postgres, no Storage API)
 *
 * Without --url it uses DIRECT_URL from .env. A --url that is not that
 * one is refused unless --yes-i-mean-this-database is also given: the
 * command creates tables and revokes privileges, and the wrong database
 * is one typo away. The SQL file runs through `prisma db execute` up to
 * its `-- @@report` marker (the report's bucket query cannot run where
 * there is no storage schema); the report is then printed from here with
 * the same queries, the bucket one skipped when the schema is absent.
 *
 * Every child is a Node process on the CLIs' own entry files, never a
 * shell: the arguments carry a connection string.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    "yes-i-mean-this-database": { type: "boolean", default: false },
    "skip-storage": { type: "boolean", default: false },
  },
});

const ROOT = process.cwd();
const SQL_FILE = path.join(ROOT, "prisma", "sql", "bootstrap.sql");
const REPORT_MARKER = "-- @@report";
const PRISMA_CLI = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

type Step = { name: string; ok: boolean; detail: string };

/** The URL with its password hidden, for the summary. */
function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username || "?"}@${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}

function run(name: string, cliArgs: string[], env: NodeJS.ProcessEnv): Step {
  console.log(`\n== ${name}`);
  const result = spawnSync(process.execPath, cliArgs, { stdio: "inherit", env, cwd: ROOT, windowsHide: true });
  const ok = result.status === 0;
  return { name, ok, detail: ok ? "ok" : `exit ${result.status ?? "signal"}` };
}

/** The SQL file up to the report marker, in a temporary file `prisma db execute` can take. */
function statementsFile(): { file: string; cleanup: () => void } {
  const text = readFileSync(SQL_FILE, "utf8");
  const at = text.indexOf(REPORT_MARKER);
  if (at < 0) throw new Error(`${SQL_FILE} has no "${REPORT_MARKER}" marker`);
  const dir = mkdtempSync(path.join(tmpdir(), "cvision-bootstrap-"));
  const file = path.join(dir, "bootstrap.statements.sql");
  writeFileSync(file, text.slice(0, at));
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const show = (label: string, rows: unknown[]) => {
  console.log(`-- ${label}: ${rows.length === 0 ? "(vacío)" : ""}`);
  for (const row of rows) console.log(`   ${JSON.stringify(row, (_key, value) => (typeof value === "bigint" ? value.toString() : value))}`);
};

/** The report section of the SQL file, as fixed queries: what the SQL editor would print. */
async function report(url: string): Promise<Step> {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    console.log("\n== reporte (sección 5 de prisma/sql/bootstrap.sql)");
    const noRls = await db.$queryRaw<{ tabla_sin_rls: string }[]>`
      SELECT c.relname AS tabla_sin_rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity ORDER BY 1`;
    show("5a tablas de public sin RLS (debe ser vacío)", noRls);
    const policies = await db.$queryRaw<unknown[]>`
      SELECT tablename, policyname, roles::text AS roles, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`;
    show("5b policies en public (debe ser vacío)", policies);
    const storagePolicies = await db.$queryRaw<unknown[]>`
      SELECT policyname, roles::text AS roles, cmd, qual, with_check FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND (coalesce(qual, '') ILIKE '%files-bucket%' OR coalesce(with_check, '') ILIKE '%files-bucket%'
             OR roles::text ILIKE '%anon%' OR roles::text ILIKE '%public%') ORDER BY 1`;
    show("5c policies de storage.objects para el bucket o anon/public (debe ser vacío)", storagePolicies);
    const grants = await db.$queryRaw<unknown[]>`
      SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') ORDER BY 2, 1, 3`;
    show("5d privilegios de anon/authenticated en public (debe ser vacío)", grants);
    const [{ hasStorage }] = await db.$queryRaw<{ hasStorage: boolean }[]>`SELECT to_regclass('storage.buckets') IS NOT NULL AS "hasStorage"`;
    let bucket: unknown[] = [];
    if (hasStorage) {
      bucket = await db.$queryRaw<unknown[]>`SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'files-bucket'`;
      show("5e bucket files-bucket (una fila: privado, 10485760, application/pdf)", bucket);
    } else {
      console.log("-- 5e bucket: sin schema storage en esta base (no es un proyecto de Supabase)");
    }
    const ok = noRls.length === 0 && policies.length === 0 && storagePolicies.length === 0 && grants.length === 0 && (!hasStorage || bucket.length === 1);
    return { name: "reporte", ok, detail: ok ? "todo como se espera" : "algo difiere (ver arriba)" };
  } catch (error) {
    return { name: "reporte", ok: false, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const configured = process.env.DIRECT_URL?.trim();
  const target = args.url?.trim() || configured;
  if (!target) throw new Error("No database: set DIRECT_URL in .env or pass --url");
  if (args.url && args.url.trim() !== configured && !args["yes-i-mean-this-database"]) {
    console.error(`Refusing: --url is not the DIRECT_URL in .env (${describeUrl(args.url)}). Pass --yes-i-mean-this-database if that is the intent.`);
    process.exit(2);
  }

  // Every child sees the target as both URLs: the Prisma CLI reads the
  // schema's env() names, and the checks read DIRECT_URL first. Node's
  // --env-file never overrides a variable already in the environment.
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: target, DIRECT_URL: target };

  console.log(`Bootstrapping ${describeUrl(target)}`);
  const steps: Step[] = [];
  steps.push(run("migraciones (prisma migrate deploy)", [PRISMA_CLI, "migrate", "deploy"], env));
  if (steps[0].ok) {
    const statements = statementsFile();
    try {
      steps.push(run("bootstrap SQL (prisma db execute, hasta el marcador del reporte)", [PRISMA_CLI, "db", "execute", "--file", statements.file, "--url", target], env));
    } finally {
      statements.cleanup();
    }
    steps.push(run("RLS (db:check-rls)", [TSX_CLI, "--env-file-if-exists=.env", path.join("scripts", "db", "check-rls.ts")], env));
    if (args["skip-storage"]) {
      steps.push({ name: "storage (storage:setup --check)", ok: true, detail: "saltado (--skip-storage)" });
    } else {
      steps.push(run("storage (storage:setup --check)", [TSX_CLI, "--conditions=react-server", "--env-file-if-exists=.env", path.join("scripts", "storage", "setup.ts"), "--check"], env));
    }
    steps.push(await report(target));
  }

  console.log("\n== resumen");
  for (const step of steps) console.log(`${step.ok ? "PASS" : "FAIL"}  ${step.name}: ${step.detail}`);
  const failed = steps.filter((step) => !step.ok).length;
  console.log(failed ? `\n${failed} paso(s) fallaron` : "\nBase lista");
  if (failed) process.exitCode = 1;
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`db:bootstrap failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exit(1);
  });
}
