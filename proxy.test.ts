import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import proxy, { config } from "./proxy";

/**
 * Clerk's wrapper is replaced by the handler itself, and its matcher by a
 * literal one, so the test drives the decision directly: which routes pass,
 * which answer 401 as JSON, and which fall through to Clerk's own protection.
 */
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (patterns: string[]) => {
    const expressions = patterns.map(
      (pattern) => new RegExp(`^${pattern.replace(/\(\.\*\)/g, ".*")}$`),
    );
    return (req: NextRequest) => expressions.some((re) => re.test(new URL(req.url).pathname));
  },
}));

type Handler = (
  auth: unknown,
  req: NextRequest,
  event: unknown,
) => Promise<Response | undefined>;

const protect = vi.fn();
const authFor = (userId: string | null) =>
  Object.assign(async () => ({ userId }), { protect });

const request = (path: string) => new NextRequest(`https://cvision.test${path}`);

const run = (path: string, userId: string | null) =>
  (proxy as unknown as Handler)(authFor(userId), request(path), {});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("proxy", () => {
  it("answers a signed-out API call with 401 JSON in the project's shape, not Clerk's 404 page", async () => {
    const response = await run("/api/interview/abc/session", null);

    expect(response).toBeInstanceOf(NextResponse);
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(protect).not.toHaveBeenCalled();
  });

  it("lets a signed-in API call through without Clerk's redirecting protection", async () => {
    expect(await run("/api/interview/abc/status", "user_1")).toBeUndefined();
    expect(protect).not.toHaveBeenCalled();
  });

  it.each(["/api/webhooks/elevenlabs", "/api/webhooks/clerk", "/api/cron/users-reconcile"])(
    "keeps the webhook %s public: no session is read and nothing is answered",
    async (path) => {
      const auth = authFor(null);
      const spy = vi.fn(auth);
      const response = await (proxy as unknown as Handler)(
        Object.assign(spy, { protect }),
        request(path),
        {},
      );

      expect(response).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
      expect(protect).not.toHaveBeenCalled();
    },
  );

  it("does not make any other /api/webhooks path public", async () => {
    expect((await run("/api/webhooks/other", null))?.status).toBe(401);
  });

  it("leaves pages to Clerk's protection, and the landing page open", async () => {
    expect(await run("/interviews", null)).toBeUndefined();
    expect(protect).toHaveBeenCalledTimes(1);

    protect.mockClear();
    expect(await run("/", null)).toBeUndefined();
    expect(protect).not.toHaveBeenCalled();
  });

  it.each(["/robots.txt", "/pricing", "/terms", "/privacy", "/refunds", "/api/webhooks/paddle", "/api/cron/storage-gc", "/api/cron/users-reconcile"])(
    "keeps %s public: nothing protected, nothing answered",
    async (path) => {
      expect(await run(path, null)).toBeUndefined();
      expect(protect).not.toHaveBeenCalled();
    },
  );

  it("answers 401 JSON for a cron or API path that is not in the table, never a 404 page", async () => {
    expect((await run("/api/cron/other", null))?.status).toBe(401);
    expect((await run("/api/nope", null))?.status).toBe(401);
    expect(protect).not.toHaveBeenCalled();
  });

  it.each(["/nope", "/wp-login.php", "/resume", "/interview/abc/extra", "/.well-known/security.txt"])(
    "lets a signed-out visit to %s, which no page serves, through to Next's not-found",
    async (path) => {
      expect(await run(path, null)).toBeUndefined();
      expect(protect).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/resume/upload",
    "/resume/analyses",
    "/resume/analysis/abc",
    "/interview/abc",
    "/interview/abc/feedback",
    "/account/billing",
    "/dev/room-preview",
    "/interview%73",
    "/INTERVIEWS",
    "/interviews/",
    "/interviews.rsc",
    "/resume/analysis/abc.segments/_tree.segment.rsc",
    "/interviews%E0%A4%A",
  ])("keeps %s, a page or anything that might reach one, behind Clerk's protection", async (path) => {
    expect(await run(path, null)).toBeUndefined();
    expect(protect).toHaveBeenCalledTimes(1);
  });

  it("treats /admin like any path no page serves: no redirect home, on to Next's not-found", async () => {
    for (const userId of [null, "user_1"]) {
      expect(await run("/admin/users", userId)).toBeUndefined();
    }
    expect(protect).not.toHaveBeenCalled();
  });
});

describe("the proxy's matcher", () => {
  // Next reads the first pattern as a whole-path expression.
  const runsOn = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

  it("runs on robots.txt and on unknown paths, so neither is left to chance", () => {
    expect(runsOn("/robots.txt")).toBe(true);
    expect(runsOn("/nope")).toBe(true);
  });

  it("skips static files, the landing's audio included, and runs on pages", () => {
    expect(runsOn("/landing/voice/es/01.mp3")).toBe(false);
    expect(runsOn("/landing/silk-still.webp")).toBe(false);
    expect(runsOn("/favicon.ico")).toBe(false);
    expect(runsOn("/")).toBe(true);
    expect(runsOn("/pricing")).toBe(true);
    expect(runsOn("/resume/analyses")).toBe(true);
  });
});
