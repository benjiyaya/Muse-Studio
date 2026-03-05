import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tell Next.js not to bundle these native modules — they run server-side only
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
