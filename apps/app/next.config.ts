import path from "node:path";
import type { NextConfig } from "next";
import { env } from "./env";

const apiUrl = env.API_INTERNAL_URL ?? env.NEXT_PUBLIC_API_URL;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  async rewrites() {
    return [
      { destination: `${apiUrl}/api/auth/:path*`, source: "/api/auth/:path*" },
      { destination: `${apiUrl}/api/:path*`, source: "/api/:path*" },
      { destination: `${apiUrl}/status`, source: "/status" },
    ];
  },
  transpilePackages: [
    "@repo/access-control",
    "@repo/api",
    "@repo/auth",
    "@repo/config",
    "@repo/design-system",
    "@t3-oss/env-core",
    "@t3-oss/env-nextjs",
  ],
};

export default nextConfig;
