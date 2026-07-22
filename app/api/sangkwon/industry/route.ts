import { NextRequest, NextResponse } from "next/server";
import { analyzeIndustry } from "@/lib/sangkwon/industry";

export const runtime = "nodejs";

// POST /api/sangkwon/industry  { lat, lng, industry }
export async function POST(req: NextRequest) {
  let body: { lat?: number; lng?: number; industry?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const { lat, lng, industry } = body;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    Number.isNaN(lat) ||
    Number.isNaN(lng)
  ) {
    return NextResponse.json({ error: "위도·경도가 필요합니다." }, { status: 400 });
  }
  if (!industry) {
    return NextResponse.json({ error: "업종을 선택하세요." }, { status: 400 });
  }

  const result = await analyzeIndustry({ lat, lng }, industry);
  if (!result) {
    return NextResponse.json({ error: "알 수 없는 업종입니다." }, { status: 400 });
  }
  return NextResponse.json(result);
}
