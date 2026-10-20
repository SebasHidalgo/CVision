/**
 * Row-level security is not something Prisma models: a database rebuilt from
 * the migrations would come back with it off unless every migration enables
 * it. This check fails when any table in `public` has it off, so the deploy
 * list can run it.
 *
 *   npm run db:check-rls              exit 1 if a public table has RLS off
 *   npm run db:check-rls -- --report  also print owners, policies and the
 *                                     connection role, for the record
 *
 * Runs over DIRECT_URL (DATABASE_URL when unset). Prints no connection string.
 */
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";

const { values: args } = parseArgs({ options: { report: { type: "boolean", default: false } } });

type TableRow = { table: string; owner: string; rls: boolean; force: boolean };
type PolicyRow = {
  schemaname: string;
  tablename: string;
  policyname: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
};
type RoleRow = {
  current_user: string;
  session_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
};

const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required");
const prisma = new PrismaClient({ datasourceUrl: url });

async function main() {
  const tables = await prisma.$queryRaw<TableRow[]>`
    SELECT c.relname AS "table", pg_get_userbyid(c.relowner) AS owner,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS force
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`;

  const off = tables.filter((table) => !table.rls);

  if (args.report) {
    const [role] = await prisma.$queryRaw<RoleRow[]>`
      SELECT current_user, session_user, r.rolsuper, r.rolbypassrls, r.rolcreatedb
      FROM pg_roles r WHERE r.rolname = current_user`;
    console.log(
      `connection: current_user=${role.current_user} session_user=${role.session_user} superuser=${role.rolsuper} bypassrls=${role.rolbypassrls} createdb=${role.rolcreatedb}`,
    );

    console.log("public tables:");
    for (const table of tables) {
      console.log(`  ${table.table.padEnd(22)} owner=${table.owner.padEnd(10)} rls=${table.rls} force=${table.force}`);
    }

    const policies = await prisma.$queryRaw<PolicyRow[]>`
      SELECT schemaname, tablename, policyname, roles::text[] AS roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname IN ('public', 'storage')
      ORDER BY schemaname, tablename, policyname`;
    console.log(`policies in public and storage: ${policies.length}`);
    for (const policy of policies) {
      console.log(
        `  ${policy.schemaname}.${policy.tablename} "${policy.policyname}": ${policy.cmd} for ${policy.roles.join(", ")} using ${policy.qual ?? "-"} with check ${policy.with_check ?? "-"}`,
      );
    }

    const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists`;
    const migrations = tables.find((table) => table.table === "_prisma_migrations");
    console.log(
      `_prisma_migrations: ${exists ? `exists, rls=${migrations?.rls ?? "?"}` : "does not exist yet"}`,
    );
  }

  if (off.length > 0) {
    console.error(`RLS is OFF on ${off.length} public table(s): ${off.map((table) => table.table).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`RLS is on for all ${tables.length} public table(s)`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
