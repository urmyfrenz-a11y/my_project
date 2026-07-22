import { NextRequest, NextResponse } from "next/server";

// 임시 진단용 — 서울 데이터셋 페이지에서 서비스명 관련 텍스트 추출. 확인 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

function contexts(text: string, needle: string, span = 120, max = 4): string[] {
  const out: string[] = [];
  let i = 0;
  while (out.length < max) {
    const idx = text.indexOf(needle, i);
    if (idx < 0) break;
    out.push(text.slice(Math.max(0, idx - span), idx + needle.length + span).replace(/\s+/g, " "));
    i = idx + needle.length;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url") ?? "";
  if (!/^https:\/\/data\.seoul\.go\.kr\//.test(target)) {
    return NextResponse.json({ error: "data.seoul.go.kr URL만 허용" }, { status: 400 });
  }
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html",
        "X-Requested-With": "XMLHttpRequest",
      },
      cache: "no-store",
    });
    const text = await res.text();
    return NextResponse.json({
      status: res.status,
      len: text.length,
      vwsm: [...new Set(text.match(/Vwsm[A-Za-z0-9]+/g) ?? [])],
      openapi: contexts(text, "openapi.seoul.go.kr"),
      svcName: contexts(text, "서비스명"),
      sample: contexts(text, "SAMPLE").concat(contexts(text, "샘플")),
      // service name tokens: /rest/services or json path
      restPaths: [...new Set(text.match(/\/(?:json|xml)\/[A-Za-z0-9]+/g) ?? [])],
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
