import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "소상공인 정책자금 찾기 — 서울·경기",
  description:
    "서울시·경기도 소상공인 정책 지원자금을 지역과 카테고리로 검색하세요. 신청 마감 전 사업만 카테고리별로 모아 원문 공고 링크까지 제공합니다.",
  openGraph: {
    title: "소상공인 정책자금 찾기 — 서울·경기",
    description:
      "지역(자치구·시군) + 카테고리로 검색해 마감 전 지원사업만 한눈에.",
    locale: "ko_KR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
