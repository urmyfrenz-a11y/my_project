// 기업마당(bizinfo.go.kr) 오픈API 어댑터
//
// 엔드포인트: https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do
//   crtfcKey  : 인증키 (마이페이지 > 오픈API 발급)
//   dataType  : json
//   searchCnt : 가져올 건수
//   searchLclasId : 지원분야 대분류 코드(선택)
//
// 응답 필드는 배포 시점에 따라 조금씩 달라, 여러 후보 키를 방어적으로 읽는다.

import { classifyCategory, CategoryName } from "./categories";
import { Province, RegionScope } from "./types";

const BIZINFO_ENDPOINT = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";

// 원본 응답 아이템(느슨한 타입)
type RawItem = Record<string, unknown>;

// 지역 매칭용 최소 정보
export interface RegionLite {
  id: string;
  province: Province;
  district: string;
}

// 정규화 결과 (route 에서 institution/category/region id 로 해석해 적재)
export interface NormalizedProgram {
  external_id: string;
  title: string;
  institution_name: string | null;
  category_name: CategoryName;
  region_scope: RegionScope;
  province: Province | null; // province_wide 일 때
  region_district: string | null; // district 일 때 (매칭된 자치구/시군명)
  summary: string | null;
  support_amount: string | null;
  apply_start: string | null; // YYYY-MM-DD
  apply_end: string | null; // YYYY-MM-DD | null(상시)
  is_ongoing: boolean;
  source_url: string | null;
}

function pick(item: RawItem, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

// "20260101" | "2026-01-01" | "2026.01.01" → "2026-01-01"
function toISODate(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  const iso = `${y}-${m}-${d}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

const ONGOING_HINTS = ["상시", "수시", "소진", "예산", "연중", "별도", "제한없"];

// "20260101 ~ 20260228" / "예산 소진시까지" 등을 파싱
function parsePeriod(raw: string | null): {
  start: string | null;
  end: string | null;
  ongoing: boolean;
} {
  if (!raw) return { start: null, end: null, ongoing: false };
  const ongoing = ONGOING_HINTS.some((h) => raw.includes(h));
  const parts = raw.split(/[~\-–]/).map((s) => s.trim());
  const start = toISODate(parts[0] ?? null);
  const end = parts.length > 1 ? toISODate(parts[1] ?? null) : null;
  return { start, end, ongoing: ongoing && !end };
}

function absoluteUrl(u: string | null): string | null {
  if (!u) return null;
  if (u.startsWith("http")) return u;
  return `https://www.bizinfo.go.kr${u.startsWith("/") ? "" : "/"}${u}`;
}

// 지역 범위 판정: 텍스트에서 시군구명/광역명을 찾는다.
function resolveRegion(
  text: string,
  regions: RegionLite[],
): { scope: RegionScope; province: Province | null; district: string | null } {
  // 1) 구체 자치구/시군 매칭 (가장 우선)
  //    '광주시'(경기) 처럼 광역시명과 겹치는 경우를 피하려 district 원문으로 매칭
  for (const r of regions) {
    if (text.includes(r.district)) {
      return { scope: "district", province: r.province, district: r.district };
    }
  }
  // 2) 광역 단위
  const hasSeoul = /서울(특별시|시)?/.test(text);
  const hasGyeonggi = /경기(도)?/.test(text);
  if (hasSeoul && !hasGyeonggi)
    return { scope: "province_wide", province: "서울", district: null };
  if (hasGyeonggi && !hasSeoul)
    return { scope: "province_wide", province: "경기", district: null };
  // 3) 그 외 → 전국 공통
  return { scope: "national", province: null, district: null };
}

/** 기업마당 API 호출 후 정규화된 프로그램 목록 반환 */
export async function fetchBizinfoPrograms(opts: {
  apiKey: string;
  regions: RegionLite[];
  searchCnt?: number;
  searchLclasId?: string;
}): Promise<NormalizedProgram[]> {
  const params = new URLSearchParams({
    crtfcKey: opts.apiKey,
    dataType: "json",
    searchCnt: String(opts.searchCnt ?? 100),
  });
  if (opts.searchLclasId) params.set("searchLclasId", opts.searchLclasId);

  const res = await fetch(`${BIZINFO_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`기업마당 API 오류: HTTP ${res.status} ${res.statusText}`);
  }
  const json: unknown = await res.json();
  const items = extractItems(json);
  return items.map((it) => normalizeItem(it, opts.regions)).filter(Boolean) as NormalizedProgram[];
}

// 응답 래퍼가 다양해 여러 위치에서 배열을 찾는다.
function extractItems(json: unknown): RawItem[] {
  if (Array.isArray(json)) return json as RawItem[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["jsonArray", "item", "items", "list"]) {
      if (Array.isArray(obj[key])) return obj[key] as RawItem[];
    }
    // response.body.items.item 형태
    const body = (obj.response as Record<string, unknown> | undefined)?.body as
      | Record<string, unknown>
      | undefined;
    const nested = (body?.items as Record<string, unknown> | undefined)?.item;
    if (Array.isArray(nested)) return nested as RawItem[];
  }
  return [];
}

function normalizeItem(item: RawItem, regions: RegionLite[]): NormalizedProgram | null {
  const title = pick(item, "pblancNm", "pblancNm", "title", "bsnsNm");
  if (!title) return null;

  const externalId =
    pick(item, "pblancId", "pblanc_id", "id", "seq") ?? `bizinfo:${title}`;
  const summary = pick(item, "bsnsSumryCn", "sumry", "cn", "description");
  const institution =
    pick(item, "excInsttNm", "jrsdInsttNm", "insttNm", "institution");
  const field = pick(item, "pldirSportRealmLclasCodeNm", "lclasNm", "clsfNm");
  const periodRaw = pick(item, "reqstBeginEndDe", "reqstDt", "period");
  const support = pick(item, "sportCn", "sportScaleCn", "supportAmount");
  const url = absoluteUrl(pick(item, "pblancUrl", "url", "detailUrl", "rgtInsttUrl"));

  const { start, end, ongoing } = parsePeriod(periodRaw);
  const category = classifyCategory(title, summary, field);
  const region = resolveRegion(`${title} ${summary ?? ""} ${institution ?? ""}`, regions);

  return {
    external_id: externalId,
    title,
    institution_name: institution,
    category_name: category,
    region_scope: region.scope,
    province: region.province,
    region_district: region.district,
    summary,
    support_amount: support,
    apply_start: start,
    apply_end: end,
    is_ongoing: ongoing,
    source_url: url,
  };
}
