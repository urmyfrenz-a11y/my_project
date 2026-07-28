import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // 모노레포(여러 앱 서브디렉토리)라 루트 lockfile 이 함께 감지된다.
  // 이 앱 디렉토리를 turbopack 루트로 고정해 경고를 없앤다.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
