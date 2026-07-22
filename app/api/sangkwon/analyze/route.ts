import { NextRequest, NextResponse } from "next/server";
import { analyzeLocation } from "@/lib/sangkwon/analyze";

export const runtime = "nodejs";
export const maxDuration = 30; // 서울 매출 최초 집계 여유

// POST /api/sangkwon/analyze  { lat, lng, address? }
export async function POST(req: NextRequest) {
  let body: { lat?: number; lng?: number; address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const { lat, lng } = body;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    Number.isNaN(lat) ||
    Number.isNaN(lng)
  ) {
    return NextResponse.json({ error: "위도(lat)·경도(lng)가 필요합니다." }, { status: 400 });
  }

  // 서울시 경계 대략 검증 (선택적 안내)
  const inSeoul = lat > 37.4 && lat < 37.7 && lng > 126.75 && lng < 127.2;

  const result = await analyzeLocation(
    { lat, lng },
    body.address?.trim() || "선택한 위치"
  );
  result.generatedAt = new Date().toISOString();

  return NextResponse.json({ ...result, inSeoul });
}
