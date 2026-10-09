import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// The landing page, plus webhook routes one by one, never a whole prefix. A
// webhook authenticates its caller itself (HMAC signature on the raw body).
// This is defense in depth: every Server Action, Route Handler and data-layer
// call checks the session again.
const isPublicRoute = createRouteMatcher(["/", "/api/webhooks/elevenlabs"]);

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req) && !(await auth()).userId) {
    const url = new URL("/", req.url);
    return NextResponse.redirect(url);
  }

  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
