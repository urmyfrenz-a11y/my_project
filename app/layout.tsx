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
  metadataBase: new URL("https://pdfdoctor-hichul-kim-s-projects.vercel.app"),
  title: "강의용 PDF 편집기",
  description: "강의 자료를 위한 가장 쉬운 PDF 편집 도구 — 분할·병합·페이지 편집·압축을 설치 없이. 업로드한 파일은 브라우저에서만 처리되어 안전합니다.",
  openGraph: {
    title: "PDF 편집을 더 쉽고, 더 완벽하게",
    description: "텍스트 수정, 주석 추가, 페이지 관리, 파일 변환까지 — 모든 기능을 하나의 도구로. 설치 없이, 안전하게.",
    siteName: "강의용 PDF 편집기",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PDF 편집을 더 쉽고, 더 완벽하게",
    description: "텍스트 수정, 주석 추가, 페이지 관리, 파일 변환까지 — 모든 기능을 하나의 도구로. 설치 없이, 안전하게.",
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