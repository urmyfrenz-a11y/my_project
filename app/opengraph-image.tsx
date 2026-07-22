import { renderOg, OG_SIZE, OG_ALT, OG_CONTENT_TYPE } from "@/lib/sangkwon/og";

// 링크 미리보기(og:image) — 카카오톡·슬랙 등에서 표시되는 카드 이미지
export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // Vercel 런타임에서 한글 폰트 fetch 후 생성
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOg();
}
