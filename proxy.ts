// Next 16 names this file proxy.ts (the middleware convention is deprecated); it runs on the Node runtime.
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isKnownPath, matchAppRoute } from "@/lib/routeAccess";

// Who may reach what is the table in lib/routeAccess.ts: the public pages,
// plus webhook and cron routes one by one, never a whole prefix. A webhook
// authenticates its caller itself (a signature on the raw body); a cron
// route, by the bearer secret Vercel sends. This is defense in depth: every
// Server Action, Route Handler and data-layer call checks the session again.
const isPublicRoute = (pathname: string) => matchAppRoute(pathname)?.access === "public";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

// An API consumer gets an honest status: Clerk's own protection answers a
// signed-out API call with its 404 page, which the room's client tolerates
// but nobody can act on.
const isApiRoute = createRouteMatcher(["/api(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  if (isPublicRoute(pathname)) return;

  if (isAdminRoute(req) && !(await auth()).userId) {
    const url = new URL("/", req.url);
    return NextResponse.redirect(url);
  }

  if (isApiRoute(req)) {
    if (!(await auth()).userId) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
    }
    return;
  }

  // A path no page could serve goes on to Next's not-found instead of the
  // sign-in wall; anything that might be a page stays protected.
  if (!isKnownPath(pathname)) return;

  await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params (mp3: the landing's example call)
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
