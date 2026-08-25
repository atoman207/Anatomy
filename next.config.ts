import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preview/final report PDFs are base64-encoded in a Server Action
  // (`uploadReportFile`). Rasterized pages with figures easily exceed the
  // default 1 MB limit, so allow up to 10 MB per request.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
