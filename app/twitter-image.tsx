import { renderOg, OG_SIZE, OG_ALT, OG_CONTENT_TYPE } from "@/lib/sangkwon/og";

// 트위터/X 카드도 동일한 미리보기 이미지 사용
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOg();
}
