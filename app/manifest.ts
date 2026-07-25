import type { MetadataRoute } from "next";

// 웹 앱 매니페스트 — 바탕화면 바로가기·홈 화면 추가 시 아이콘/이름 제공
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "서울 상권분석",
    short_name: "상권분석",
    description: "공공데이터 9종 기반 서울 상권 분석 — 종합 점수와 인사이트",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4f46e5",
    lang: "ko",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
