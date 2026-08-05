import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // 이 폴더를 워크스페이스 루트로 고정 — 상위(모노레포)의 lockfile/postcss 설정을
  // 잘못 상속하지 않도록 한다.
  turbopack: { root: here },
};

export default nextConfig;
