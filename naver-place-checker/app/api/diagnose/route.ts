import { NextRequest, NextResponse } from "next/server";
import {
  extractEmbeddedState,
  normalize,
  parseNaverUrl,
  placeHomeUrl,
  type ParsedUrl,
} from "@/lib/extract";
import { buildRows, bizTypeLabel, scoreOf } from "@/lib/checklist";
import { hasKey, looksBlocked, renderNaver, resolveShortLink } from "@/lib/scrapingdog";
import type { DiagnoseResult } from "@/lib/types";

// 렌더링(동적) 호출이 길어 여유 있게. Vercel Hobby 함수 상한(60s) 안으로.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let url = "";
  let debug = false;
  try {
    const body = await req.json();
    url = String(body?.url ?? "").trim();
    debug = !!body?.debug;
  } catch {
    /* ignore */
  }

  if (!url) return json({ ok: false, errorCode: "INVALID_URL", error: "URL을 입력해 주세요." });

  if (!hasKey()) {
    return json({
      ok: false,
      errorCode: "NO_KEY",
      error:
        "서버에 SCRAPINGDOG_API_KEY 가 설정되지 않았습니다. 네이버는 데이터센터 IP를 차단하므로 한국 IP 경유 키가 필요합니다.",
    });
  }

  // 1) URL → placeId 해석 (naver.me 단축링크는 한 번 풀어준다)
  let parsed: ParsedUrl | null = parseNaverUrl(url);
  if (!parsed) {
    const isShort = /naver\.me/i.test(url);
    if (isShort) {
      const real = await resolveShortLink(url.startsWith("http") ? url : "https://" + url);
      if (real) parsed = parseNaverUrl(real);
    }
  }
  if (!parsed) {
    return json({
      ok: false,
      errorCode: "INVALID_URL",
      error:
        "네이버 플레이스 주소를 인식하지 못했습니다. 네이버 지도에서 매장을 연 뒤 '공유 → URL 복사'한 링크를 붙여넣어 주세요.",
    });
  }

  // 2) 홈 페이지 렌더링
  const home = placeHomeUrl(parsed.type, parsed.id);
  const { ok, status, body } = await renderNaver(home, true, 55000);
  if (!ok) {
    return json({
      ok: false,
      errorCode: "UPSTREAM",
      error: `네이버 페이지를 불러오지 못했습니다. (upstream ${status}) 잠시 후 다시 시도해 주세요.`,
    });
  }
  if (looksBlocked(body)) {
    return json({
      ok: false,
      errorCode: "BLOCKED",
      error: "네이버가 접근을 일시 차단했습니다(캡차). 잠시 후 다시 시도해 주세요.",
    });
  }

  // 3) 내장 상태 추출 → 정규화
  const state = extractEmbeddedState(body);
  if (!state) {
    return json({
      ok: false,
      errorCode: "NOT_FOUND",
      error:
        "이 주소에서 플레이스 정보를 찾지 못했습니다. 존재하는 매장 페이지가 맞는지 확인해 주세요.",
      debug: debug ? { htmlLength: body.length, home } : undefined,
    });
  }

  const place = normalize(state, parsed);
  if (!place.name && !place.category && place.photoCount === 0) {
    // 상태는 있으나 우리가 아는 필드가 하나도 안 잡힌 경우 → 파서 튜닝 필요
    return json({
      ok: false,
      errorCode: "NOT_FOUND",
      error: "플레이스 정보를 해석하지 못했습니다. (파서 조정 필요)",
      debug: debug ? { keys: Object.keys(state).slice(0, 40), home } : undefined,
    });
  }

  const rows = buildRows(place);
  const score = scoreOf(rows);

  return json({
    ok: true,
    place: {
      id: place.id,
      name: place.name ?? "이름 미상",
      category: place.category,
      bizTypeLabel: bizTypeLabel(place.bizType),
      url: home,
    },
    rows,
    score,
    debug: debug ? place : undefined,
  });
}

function json(r: DiagnoseResult) {
  return NextResponse.json(r, { status: 200 });
}
