import type { MetadataRoute } from "next";

// 공개 사이트: 모든 크롤러 허용 (og:image 크롤러 포함)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    host: "https://seoul-sangkwon.vercel.app",
  };
}
// PWA/서비스워커 배포 반영을 위한 트리거 커밋
