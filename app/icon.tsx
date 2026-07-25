import { renderIconPng } from "@/lib/sangkwon/iconImage";

// 브라우저 탭 파비콘 (PNG)
export const runtime = "nodejs";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return renderIconPng(512);
}
