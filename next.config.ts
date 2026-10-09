import type { NextConfig } from "next";
import { MAX_ACTION_BODY_BYTES } from "@/lib/uploadLimits";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Derived from the CV limit and kept under Vercel's 4.5 MB request cap;
      // raising it past that cap would only move the 413 to the platform.
      bodySizeLimit: MAX_ACTION_BODY_BYTES,
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },
};
export default nextConfig;
