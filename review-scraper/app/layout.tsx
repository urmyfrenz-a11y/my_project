import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "장소 리뷰 수집기",
  description:
    "구글맵 · 카카오맵 · 네이버 플레이스에서 장소를 검색하면 리뷰를 통합 스키마로 수집합니다.",
  openGraph: {
    title: "장소 리뷰 수집기",
    description: "구글맵 · 카카오맵 · 네이버 플레이스 리뷰를 한 곳에서 수집",
    locale: "ko_KR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
