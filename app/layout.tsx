import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://seoul-sangkwon.vercel.app"),
  title: "서울 상권분석 | 지도로 찾는 우리 동네 상권 점수",
  description:
    "서울 지도에서 위치를 선택하거나 주소를 검색하면 유동인구·매출·배후수요·소비력·임대료·접근성 등 9개 팩터로 상권을 분석해 한 장의 인포그래픽과 상권 점수로 보여줍니다.",
  openGraph: {
    title: "서울 상권분석 — 지도로 찾는 상권 점수",
    description: "공공데이터 9종 기반으로 서울 상권을 분석해 종합 점수와 인사이트를 도출합니다.",
    url: "https://seoul-sangkwon.vercel.app",
    siteName: "서울 상권분석",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "서울 상권분석 — 지도로 찾는 상권 점수",
    description: "공공데이터 9종 기반으로 서울 상권을 분석해 종합 점수와 인사이트를 도출합니다.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
