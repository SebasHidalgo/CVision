import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import middleware from "./middleware";

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
  (middleware as unknown as Handler)(authFor(userId), request(path), {});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("middleware", () => {
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

  it.each(["/api/webhooks/elevenlabs", "/api/webhooks/clerk"])(
    "keeps the webhook %s public: no session is read and nothing is answered",
    async (path) => {
      const auth = authFor(null);
      const spy = vi.fn(auth);
      const response = await (middleware as unknown as Handler)(
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

  it("sends a signed-out admin visit home", async () => {
    const response = await run("/admin/users", null);
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("https://cvision.test/");
  });
});
