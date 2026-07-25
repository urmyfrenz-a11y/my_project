import { renderIconPng } from "@/lib/sangkwon/iconImage";

// iOS/브라우저 홈·바탕화면 추가용 아이콘
export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderIconPng(180);
}
