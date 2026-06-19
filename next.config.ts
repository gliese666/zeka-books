import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent pdf-parse and canvas from being bundled by Turbopack
  serverExternalPackages: ["pdf-parse", "canvas"],
  // instrumentation.ts is enabled by default in Next.js 16 — no flag needed
};

export default nextConfig;
