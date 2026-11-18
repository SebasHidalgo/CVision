import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROUTES, isKnownPath, matchAppRoute } from "./routeAccess";

const APP = path.resolve(__dirname, "..", "app");

// Files that make a URL: pages (dev-only ones included), route handlers and the metadata routes.
const PAGE_FILE = /^page\.(dev\.tsx|tsx|ts|jsx|js)$/;
const ROUTE_FILE = /^route\.(ts|tsx|js)$/;
const METADATA_FILES: Record<string, string> = {
  "robots.ts": "robots.txt",
  "sitemap.ts": "sitemap.xml",
  "manifest.ts": "manifest.webmanifest",
};

/** Every URL app/ serves, in Next's bracket syntax: route groups and slots dropped, private `_folders` skipped. */
function urlsUnder(dir: string, segments: string[] = []): string[] {
  const urls: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue;
      const routeless = /^\(.*\)$/.test(entry.name) || entry.name.startsWith("@");
      urls.push(...urlsUnder(path.join(dir, entry.name), routeless ? segments : [...segments, entry.name]));
      continue;
    }
    if (PAGE_FILE.test(entry.name) || ROUTE_FILE.test(entry.name)) urls.push(`/${segments.join("/")}`);
    const metadata = METADATA_FILES[entry.name];
    if (metadata) urls.push(`/${[...segments, metadata].join("/")}`);
  }
  return urls;
}

const sample = (routePath: string) =>
  routePath.replace(/\[\[\.\.\.[^\]]+\]\]/g, "x/y").replace(/\[\.\.\.[^\]]+\]/g, "x/y").replace(/\[[^\]]+\]/g, "abc123");

describe("the proxy's route table", () => {
  it("classifies every page and route handler under app/, and nothing that isn't there", () => {
    const served = [...new Set(urlsUnder(APP))].sort();
    const classified = APP_ROUTES.map((route) => route.path).sort();
    expect(served.length).toBeGreaterThan(10);
    // A failure here names the URL: add a row to APP_ROUTES (public only on purpose) or remove the stale one.
    expect(classified).toEqual(served);
  });

  it("has exactly these public URLs: making one public is an edit to this list", () => {
    expect(APP_ROUTES.filter((route) => route.access === "public").map((route) => route.path)).toEqual([
      "/",
      "/pricing",
      "/terms",
      "/privacy",
      "/refunds",
      "/robots.txt",
      "/api/webhooks/elevenlabs",
      "/api/webhooks/clerk",
      "/api/webhooks/paddle",
      "/api/cron/storage-gc",
      "/api/cron/users-reconcile",
    ]);
  });

  it("matches a concrete URL of every row back to that row", () => {
    for (const route of APP_ROUTES) expect(matchAppRoute(sample(route.path)), route.path).toBe(route);
  });
});

describe("matchAppRoute", () => {
  it("matches whole segments only, never a prefix", () => {
    expect(matchAppRoute("/pricing")?.access).toBe("public");
    expect(matchAppRoute("/pricing/")?.access).toBe("public");
    expect(matchAppRoute("/pricing/extra")).toBeNull();
    expect(matchAppRoute("/api/webhooks/other")).toBeNull();
    expect(matchAppRoute("/api/webhooks")).toBeNull();
    expect(matchAppRoute("/interview/abc/feedback")?.path).toBe("/interview/[id]/feedback");
    expect(matchAppRoute("/interview/abc/other")).toBeNull();
    expect(matchAppRoute("/resume")).toBeNull();
  });
});

describe("isKnownPath", () => {
  it.each(["/interviews", "/resume/upload", "/interview/abc", "/", "/robots.txt"])("knows %s", (p) => {
    expect(isKnownPath(p)).toBe(true);
  });

  it.each([
    "/interview%73",
    "/INTERVIEWS",
    "/Resume/Upload",
    "/interviews.rsc",
    "/interviews.segments/_tree.segment.rsc",
    "/interview/abc.rsc",
    "/interview/abc/feedback.segments/x.segment.rsc",
    "/interviews;x=1",
    "/interviews%5C",
    "/x/%2e%2e/interviews",
    "/%252Finterviews",
    "/interviews%E0%A4%A",
  ])("treats %s as possibly a page (loose reading or malformed encoding)", (p) => {
    expect(isKnownPath(p)).toBe(true);
  });

  it.each(["/nope", "/wp-admin/setup-config.php", "/resume", "/interview/abc/extra", "/.well-known/security.txt", "/sitemap.xml"])(
    "knows %s is no page",
    (p) => {
      expect(isKnownPath(p)).toBe(false);
    },
  );
});
