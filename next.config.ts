import type { NextConfig } from "next";
import { securityHeaderRules } from "@/lib/securityHeaders";
import { MAX_ACTION_BODY_BYTES } from "@/lib/uploadLimits";

/** The hosts a developer opens the dev server through besides localhost: the tunnel the webhooks need. */
function devOrigins(): string[] {
  const hosts = new Set<string>();
  for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.E2E_PUBLIC_URL]) {
    try {
      const host = value ? new URL(value).hostname : "";
      if (host && host !== "localhost") hosts.add(host);
    } catch {
      // Not a URL: nothing to allow.
    }
  }
  return [...hosts];
}

// The browser suite's own production build (e2e/server.mjs): its own folder, and the dev-only pages, which still answer 404 without dev tools.
const e2eBuild = process.env.E2E_BUILD === "1";

const nextConfig: NextConfig = {
  distDir: e2eBuild ? ".next-e2e" : ".next",
  // Dev-only pages are page.dev.tsx: a production build doesn't know the extension.
  pageExtensions: process.env.NODE_ENV === "production" && !e2eBuild ? ["tsx", "ts", "jsx", "js"] : ["dev.tsx", "tsx", "ts", "jsx", "js"],
  experimental: {
    serverActions: {
      // No action carries a file: the CV goes to storage over a signed URL
      // and the analysis action receives its key and the posting's text.
      bodySizeLimit: MAX_ACTION_BODY_BYTES,
    },
  },
  // The dev server answers its own assets to a page opened through the
  // tunnel only when told the host; production ignores this.
  allowedDevOrigins: devOrigins(),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },
  // The Content-Security-Policy and its companions, built from the same
  // environment the app runs on (lib/securityHeaders.ts).
  async headers() {
    return securityHeaderRules(process.env);
  },
};
export default nextConfig;
