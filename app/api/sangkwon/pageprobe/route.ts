import { NextRequest, NextResponse } from "next/server";

// 임시 진단용 — 서울 데이터셋 페이지에서 서비스명(Vwsm...) 추출. 확인 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url") ?? "";
  // 안전: 서울 열린데이터광장만 허용
  if (!/^https:\/\/data\.seoul\.go\.kr\//.test(target)) {
    return NextResponse.json({ error: "data.seoul.go.kr URL만 허용" }, { status: 400 });
  }
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html",
      },
      cache: "no-store",
    });
    const text = await res.text();
    const vwsm = [...new Set(text.match(/Vwsm[A-Za-z0-9]+/g) ?? [])];
    const jsonPaths = [...new Set(text.match(/\/json\/[A-Za-z0-9]+/g) ?? [])];
    return NextResponse.json({ status: res.status, len: text.length, vwsm, jsonPaths });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
