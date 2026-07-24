import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "장소 리뷰 수집기 — 구글·카카오·네이버 리뷰 한눈에",
  description:
    "구글맵 · 카카오맵 · 네이버 플레이스의 리뷰를 검색 한 번으로 통합 수집해 별점과 함께 보여드립니다.",
  openGraph: {
    title: "장소 리뷰 수집기",
    description: "구글 · 카카오 · 네이버 리뷰를 한 곳에서 통합 수집",
    locale: "ko_KR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
