import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUCKET_SETTINGS, RESUME_BUCKET } from "@/lib/supabase/server";
import { MAX_RESUME_BYTES } from "@/lib/uploadLimits";

/**
 * The bootstrap SQL carries the bucket's numbers as literals (SQL has no
 * import): they must be the ones the app enforces, so a change to
 * lib/uploadLimits.ts or BUCKET_SETTINGS fails here until the SQL follows.
 */

const sql = readFileSync(path.resolve(__dirname, "bootstrap.sql"), "utf8");

describe("prisma/sql/bootstrap.sql", () => {
  it("creates the bucket with the app's name, size limit and MIME type", () => {
    const insert = /INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s*VALUES \('([^']+)', '([^']+)', (true|false), (\d+), ARRAY\['([^']+)'\]\)/.exec(sql);
    expect(insert, "the bucket INSERT was not found in the expected shape").not.toBeNull();
    const [, id, name, isPublic, sizeLimit, mime] = insert!;
    expect(id).toBe(RESUME_BUCKET);
    expect(name).toBe(RESUME_BUCKET);
    expect(isPublic).toBe(String(BUCKET_SETTINGS.public));
    expect(Number(sizeLimit)).toBe(MAX_RESUME_BYTES);
    expect(Number(sizeLimit)).toBe(10 * 1024 * 1024);
    expect([mime]).toEqual([...BUCKET_SETTINGS.allowedMimeTypes]);
  });

  it("is idempotent by construction: no bare CREATE, DROP or GRANT, every write guarded", () => {
    const statements = sql.replace(/--[^\n]*/g, "");
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bGRANT\b/i);
    expect(statements).not.toMatch(/\bCREATE (TABLE|INDEX|POLICY)\b/i);
    expect(statements).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(statements).toMatch(/NOT c\.relrowsecurity/);
    expect(statements).toMatch(/to_regclass\('storage\.buckets'\) IS NULL/);
  });

  it("enables RLS by a loop over every public table, and revokes from anon and authenticated with default privileges", () => {
    expect(sql).toMatch(/FOR t IN[\s\S]*nspname = 'public'[\s\S]*ENABLE ROW LEVEL SECURITY/);
    for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
      expect(sql).toContain(`REVOKE ALL PRIVILEGES ON ALL ${kind} IN SCHEMA public FROM anon, authenticated`);
      expect(sql).toContain(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL PRIVILEGES ON ${kind} FROM anon, authenticated`);
    }
    // service_role is named in the comments (left alone, on purpose), never in a statement.
    expect(sql.replace(/--[^\n]*/g, "")).not.toMatch(/service_role/i);
  });

  it("ends with the read-only report the owner pastes into the SQL editor, behind the marker the runner stops at", () => {
    expect(sql.indexOf("-- @@report")).toBeGreaterThan(sql.indexOf("-- 4. El bucket"));
    const report = sql.slice(sql.indexOf("-- 5. Reporte"));
    expect(report).toMatch(/tabla_sin_rls/);
    expect(report).toMatch(/pg_policies[\s\S]*schemaname = 'public'/);
    expect(report).toMatch(/schemaname = 'storage' AND tablename = 'objects'/);
    expect(report).toMatch(/role_table_grants/);
    expect(report).toMatch(/FROM storage\.buckets/);
    expect(report.replace(/--[^\n]*/g, "")).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
  });
});
