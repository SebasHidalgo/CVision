/**
 * Every page and route handler under app/, by its URL in Next's own
 * bracket syntax, and who may reach it through the proxy. The proxy reads
 * this table; `lib/routeAccess.test.ts` walks app/ and fails when a file
 * has no row here or a row has no file, so a new page can never become
 * public by omission. Import-free: the proxy, robots.ts and tests read it.
 */

export type RouteAccess = "public" | "signed-in";

export type AppRoute = { readonly path: string; readonly access: RouteAccess };

export const APP_ROUTES: readonly AppRoute[] = [
  // Pages anyone can read.
  { path: "/", access: "public" },
  { path: "/pricing", access: "public" },
  { path: "/terms", access: "public" },
  { path: "/privacy", access: "public" },
  { path: "/refunds", access: "public" },
  { path: "/robots.txt", access: "public" },
  // Webhooks authenticate by a signature over the raw body; crons by the bearer Vercel sends.
  { path: "/api/webhooks/elevenlabs", access: "public" },
  { path: "/api/webhooks/clerk", access: "public" },
  { path: "/api/webhooks/paddle", access: "public" },
  { path: "/api/cron/storage-gc", access: "public" },
  { path: "/api/cron/users-reconcile", access: "public" },
  // The app.
  { path: "/account/billing", access: "signed-in" },
  { path: "/dev/room-preview", access: "signed-in" },
  { path: "/interview/[id]", access: "signed-in" },
  { path: "/interview/[id]/feedback", access: "signed-in" },
  { path: "/interviews", access: "signed-in" },
  { path: "/resume/analyses", access: "signed-in" },
  { path: "/resume/analysis/[id]", access: "signed-in" },
  { path: "/resume/upload", access: "signed-in" },
  { path: "/api/billing/status", access: "signed-in" },
  { path: "/api/interview/[id]/ended", access: "signed-in" },
  { path: "/api/interview/[id]/session", access: "signed-in" },
  { path: "/api/interview/[id]/status", access: "signed-in" },
];

const segmentsOf = (path: string) => path.split("/").filter(Boolean);

function segmentsMatch(pattern: string[], actual: string[]): boolean {
  for (let i = 0; i < pattern.length; i += 1) {
    const part = pattern[i];
    if (part.startsWith("[[...")) return true;
    if (part.startsWith("[...")) return actual.length > i;
    if (i >= actual.length) return false;
    if (!part.startsWith("[") && part !== actual[i]) return false;
  }
  return pattern.length === actual.length;
}

// Next's precedence: a static segment beats a dynamic one, which beats a catch-all.
const weight = (part: string) => (part.startsWith("[[...") ? 0 : part.startsWith("[...") ? 1 : part.startsWith("[") ? 2 : 3);

function moreSpecific(a: string[], b: string[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] === undefined ? -1 : weight(a[i])) - (b[i] === undefined ? -1 : weight(b[i]));
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** The row whose URL this pathname is, matched segment by segment (a repeated or trailing slash is not a new segment); the most specific row wins, as in Next. */
export function matchAppRoute(pathname: string): AppRoute | null {
  const actual = segmentsOf(pathname);
  let best: { route: AppRoute; parts: string[] } | null = null;
  for (const route of APP_ROUTES) {
    const parts = segmentsOf(route.path);
    if (segmentsMatch(parts, actual) && (!best || moreSpecific(parts, best.parts))) best = { route, parts };
  }
  return best?.route ?? null;
}

/**
 * Whether a pathname could be served by any page or handler: the raw path,
 * and a deliberately loose reading of it (decoded, lower-cased, backslashes
 * as slashes, dot segments resolved, cut at a segment's `;` and at its
 * first non-leading dot, so `/interviews.rsc` or a segment prefetch counts
 * as `/interviews`). Only a
 * path that is no route under either reading may skip the sign-in wall;
 * erring towards "known" keeps a page protected, never the other way.
 */
export function isKnownPath(pathname: string): boolean {
  if (matchAppRoute(pathname)) return true;
  let loose = pathname.replace(/\\/g, "/");
  try {
    for (let round = 0; round < 3 && /%[0-9a-f]{2}/i.test(loose); round += 1) loose = decodeURIComponent(loose);
  } catch {
    // Malformed encoding: no route can be ruled out.
    return true;
  }
  const kept: string[] = [];
  for (const segment of segmentsOf(loose.replace(/\\/g, "/").toLowerCase())) {
    const plain = segment.split(";")[0];
    if (plain === ".") continue;
    if (plain === "..") {
      kept.pop();
      continue;
    }
    const dot = plain.indexOf(".", 1);
    if (dot === -1) {
      kept.push(plain);
      continue;
    }
    kept.push(plain.slice(0, dot));
    break;
  }
  return matchAppRoute(`/${kept.join("/")}`) !== null;
}
