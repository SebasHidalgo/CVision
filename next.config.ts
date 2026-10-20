import type { NextConfig } from "next";
import { MAX_ACTION_BODY_BYTES } from "@/lib/uploadLimits";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // No action carries a file: the CV goes to storage over a signed URL
      // and the analysis action receives its key and the posting's text.
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
