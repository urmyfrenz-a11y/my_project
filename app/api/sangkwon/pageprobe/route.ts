import { NextRequest, NextResponse } from "next/server";

// 임시 진단용. 확인 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

function ctx(text: string, needle: string, span = 140, max = 6): string[] {
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const out: string[] = [];
  let i = 0;
  while (out.length < max) {
    const idx = lower.indexOf(n, i);
    if (idx < 0) break;
    out.push(text.slice(Math.max(0, idx - span), idx + needle.length + span).replace(/\s+/g, " "));
    i = idx + needle.length;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url") ?? "";
  if (!/^https?:\/\/(www\.)?(reb\.or\.kr|data\.seoul\.go\.kr|www\.data\.go\.kr|apis\.data\.go\.kr|openapi\.reb\.or\.kr)\//.test(target)) {
    return NextResponse.json({ error: "허용되지 않은 URL" }, { status: 400 });
  }
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html,application/json,application/xml",
      },
      cache: "no-store",
    });
    const text = await res.text();
    return NextResponse.json({
      status: res.status,
      len: text.length,
      title: (text.match(/<title>([^<]*)<\/title>/) ?? [])[1],
      notFound: /찾을 수 없|not found|에러|error/i.test(text.slice(0, 3000)),
      authKey: ctx(text, "인증키"),
      apply: ctx(text, "신청"),
      openapi: ctx(text, "OpenAPI").concat(ctx(text, "오픈API")),
      statbl: [...new Set(text.match(/STATBL_ID|DTACYCLE_CD|GRP_ID|ITM_ID|[A-Z]{2,}_ID/g) ?? [])].slice(0, 20),
      sampleUrls: [...new Set(text.match(/https?:\/\/[^\s"'<>]*openapi[^\s"'<>]*/gi) ?? [])].slice(0, 10),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
