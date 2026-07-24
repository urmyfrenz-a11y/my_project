import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright is a runtime-only optional dep on the scraper worker; never
  // bundle it (and don't fail the build when it's absent, e.g. on Vercel).
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
