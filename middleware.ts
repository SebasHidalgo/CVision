import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// The landing page, plus webhook routes one by one, never a whole prefix. A
// webhook authenticates its caller itself (HMAC signature on the raw body).
// This is defense in depth: every Server Action, Route Handler and data-layer
// call checks the session again.
const isPublicRoute = createRouteMatcher(["/", "/api/webhooks/elevenlabs", "/api/webhooks/clerk"]);

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

// An API consumer gets an honest status: Clerk's own protection answers a
// signed-out API call with its 404 page, which the room's client tolerates
// but nobody can act on.
const isApiRoute = createRouteMatcher(["/api(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

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

  await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
