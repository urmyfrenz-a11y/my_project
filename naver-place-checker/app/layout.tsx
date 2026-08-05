import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "플레이스 닥터 · 네이버 플레이스 세팅 진단",
  description:
    "네이버 플레이스 주소만 붙여넣으면 필수 세팅을 점검하고 항목별 권고안을 드립니다.",
  applicationName: "플레이스 닥터",
  openGraph: {
    title: "플레이스 닥터 · 네이버 플레이스 세팅 진단",
    description:
      "네이버 플레이스 주소만 붙여넣으면 필수 세팅을 점검하고 항목별 권고안을 드립니다.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#03c75a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
