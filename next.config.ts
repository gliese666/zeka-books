import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent pdf-parse and canvas from being bundled by Turbopack
  serverExternalPackages: ["pdf-parse", "canvas"],
};

export default nextConfig;
