import { NextRequest, NextResponse } from "next/server";

// 임시 진단용. 확인 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

function ctx(text: string, needle: string, span = 160, max = 5): string[] {
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
  if (!/^https:\/\/(data\.seoul\.go\.kr|www\.data\.go\.kr|apis\.data\.go\.kr)\//.test(target)) {
    return NextResponse.json({ error: "허용되지 않은 URL" }, { status: 400 });
  }
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html,application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    return NextResponse.json({
      status: res.status,
      len: text.length,
      apiType: ctx(text, "API 유형").concat(ctx(text, "REST")).concat(ctx(text, "LINK")),
      endpoint: [...new Set(text.match(/https?:\/\/apis\.data\.go\.kr[^\s"'<>]*/g) ?? [])].slice(0, 10),
      endpointCtx: ctx(text, "엔드포인트").concat(ctx(text, "End Point")).concat(ctx(text, "요청주소")),
      head: text.slice(0, 400),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
