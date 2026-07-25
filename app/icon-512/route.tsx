import { renderIconPng } from "@/lib/sangkwon/iconImage";

// 매니페스트 아이콘 512 (고정 경로)
export const runtime = "nodejs";

export function GET() {
  return renderIconPng(512);
}
