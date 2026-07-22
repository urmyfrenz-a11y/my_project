import { NextRequest, NextResponse } from "next/server";
import { geocode, kakaoConfigured } from "@/lib/sangkwon/kakao";

export const runtime = "nodejs";

// GET /api/sangkwon/geocode?q=서울시청
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "검색어(q)가 필요합니다." }, { status: 400 });
  }
  if (!kakaoConfigured()) {
    return NextResponse.json(
      {
        error:
          "KAKAO_REST_KEY 가 설정되지 않았습니다. 지도를 클릭해 위치를 선택하거나, .env.local 에 카카오 REST 키를 넣어주세요.",
        configured: false,
      },
      { status: 503 }
    );
  }
  const result = await geocode(q);
  if (!result) {
    return NextResponse.json({ error: "검색 결과가 없습니다." }, { status: 404 });
  }
  return NextResponse.json(result);
}
