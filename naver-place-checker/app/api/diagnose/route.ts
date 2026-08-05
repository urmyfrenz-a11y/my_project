import { NextRequest, NextResponse } from "next/server";
import {
  extractEmbeddedState,
  normalize,
  parseNaverUrl,
  placeHomeUrl,
  type ParsedUrl,
} from "@/lib/extract";
import { buildRows, bizTypeLabel, scoreOf } from "@/lib/checklist";
import { hasApify, fetchPlaceViaApify } from "@/lib/apify";
import { hasKey, looksBlocked, renderNaver, resolveShortLink } from "@/lib/scrapingdog";
import type { DiagnoseResult, NormalizedPlace } from "@/lib/types";

// 렌더링/액터 호출이 길어 여유 있게. Vercel Hobby 함수 상한(60s) 안으로.
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

  // 링크 표시용 place id/type (naver.me 단축링크는 여기서 null → 나중에 보완)
  const parsed: ParsedUrl | null = parseNaverUrl(url);

  // ── 1순위: Apify(Naver Map Scraper) — URL을 그대로 받고 네이버 접근을 처리 ──
  if (hasApify()) {
    return diagnoseViaApify(url, parsed, debug);
  }

  // ── 2순위: Scrapingdog(한국 IP 렌더링) 폴백 ──
  if (hasKey()) {
    return diagnoseViaScrapingdog(url, parsed, debug);
  }

  return json({
    ok: false,
    errorCode: "NO_KEY",
    error:
      "데이터 수집이 설정되지 않았습니다. 환경변수 APIFY_TOKEN(권장) 또는 SCRAPINGDOG_API_KEY 를 등록해 주세요.",
  });
}

// ─────────────────────────────────────────────────────────────
async function diagnoseViaApify(url: string, parsed: ParsedUrl | null, debug: boolean) {
  const r = await fetchPlaceViaApify(url);
  if (!r.ok || !r.item) {
    return json({
      ok: false,
      errorCode: "UPSTREAM",
      error: `네이버 정보를 불러오지 못했습니다. ${r.error ?? ""}`.trim(),
      debug: debug ? r : undefined,
    });
  }
  const item = r.item;

  // place id: URL에서 못 뽑았으면 액터 결과에서 보완
  const idFromItem = String(item.placeId ?? item.id ?? item.seq ?? "");
  const pid = parsed?.id ?? (/^\d{6,}$/.test(idFromItem) ? idFromItem : "unknown");
  const ptype = parsed?.type ?? "place";

  const place = normalize(item, { id: pid, type: ptype });
  if (!place.name && !place.category && place.photoCount === 0) {
    return json({
      ok: false,
      errorCode: "NOT_FOUND",
      error: "플레이스 정보를 해석하지 못했습니다. (필드 매핑 조정 필요)",
      debug: debug ? { keys: Object.keys(item), item } : undefined,
    });
  }

  const homeUrl =
    pid !== "unknown"
      ? placeHomeUrl(ptype, pid)
      : typeof item.url === "string"
        ? (item.url as string)
        : url;

  return finish(
    place,
    homeUrl,
    debug ? { source: "apify", fields: summarize(item), parsed: place } : undefined,
  );
}

// ─────────────────────────────────────────────────────────────
async function diagnoseViaScrapingdog(url: string, parsedIn: ParsedUrl | null, debug: boolean) {
  // naver.me 단축링크는 한 번 풀어준다
  let parsed = parsedIn;
  if (!parsed && /naver\.me/i.test(url)) {
    const real = await resolveShortLink(url.startsWith("http") ? url : "https://" + url);
    if (real) parsed = parseNaverUrl(real);
  }
  if (!parsed) {
    return json({
      ok: false,
      errorCode: "INVALID_URL",
      error:
        "네이버 플레이스 주소를 인식하지 못했습니다. 네이버 지도에서 매장을 연 뒤 '공유 → URL 복사'한 링크를 붙여넣어 주세요.",
    });
  }

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
  const state = extractEmbeddedState(body);
  if (!state) {
    return json({
      ok: false,
      errorCode: "NOT_FOUND",
      error: "이 주소에서 플레이스 정보를 찾지 못했습니다.",
      debug: debug ? { htmlLength: body.length, home } : undefined,
    });
  }
  const place = normalize(state, parsed);
  if (!place.name && !place.category && place.photoCount === 0) {
    return json({
      ok: false,
      errorCode: "NOT_FOUND",
      error: "플레이스 정보를 해석하지 못했습니다. (파서 조정 필요)",
      debug: debug ? { keys: Object.keys(state).slice(0, 40), home } : undefined,
    });
  }
  return finish(place, home, debug ? { source: "scrapingdog", place } : undefined);
}

// ─────────────────────────────────────────────────────────────
function finish(place: NormalizedPlace, homeUrl: string, debugData: unknown) {
  const rows = buildRows(place);
  const score = scoreOf(rows);
  return json({
    ok: true,
    place: {
      id: place.id,
      name: place.name ?? "이름 미상",
      category: place.category,
      bizTypeLabel: bizTypeLabel(place.bizType),
      url: homeUrl,
    },
    rows,
    score,
    debug: debugData,
  });
}

function json(r: DiagnoseResult) {
  return NextResponse.json(r, { status: 200 });
}

/** 디버그용: 원본 객체를 필드명+타입+짧은 값으로 압축(깊이 2). 실제 필드명 확인용. */
function summarize(v: unknown, depth = 2): unknown {
  if (Array.isArray(v)) {
    return `Array(${v.length})` + (v.length && depth > 0 ? ` of ${JSON.stringify(summarize(v[0], depth - 1))}` : "");
  }
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[k] = depth > 0 ? summarize(val, depth - 1) : typeof val;
    }
    return o;
  }
  if (typeof v === "string") return v.length > 70 ? v.slice(0, 70) + "…" : v;
  return v;
}
