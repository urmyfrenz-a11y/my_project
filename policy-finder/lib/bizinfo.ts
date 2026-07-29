// 기업마당(bizinfo.go.kr) 오픈API 어댑터
//
// 엔드포인트: https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do
//   crtfcKey  : 인증키
//   dataType  : json
//   searchCnt : 가져올 건수
//   hashtags  : 지역 등 태그 필터 (예: 서울, 경기)
//
// 실제 응답(확인됨)은 { jsonArray: [ {pblancNm, pblancId, bsnsSumryCn,
//   excInsttNm, reqstBeginEndDe, pblancUrl, pldirSportRealmLclasCodeNm,
//   hashtags, ...} ] } 형태.

import { classifyCategory, CategoryName } from "./categories";
import { Province, RegionScope } from "./types";

const BIZINFO_ENDPOINT = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";

// 서울·경기가 아닌 타 광역(이 지역 전용 공고는 제외 대상)
const OTHER_REGION_KEYWORDS = [
  "부산", "대구", "인천", "대전", "울산", "세종",
  "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  "광주광역시", // '경기 광주시'와 구분: 광역시만 타지역으로
];

type RawItem = Record<string, unknown>;

export interface RegionLite {
  id: string;
  province: Province;
  district: string;
}

export interface NormalizedProgram {
  external_id: string;
  title: string;
  institution_name: string | null;
  category_name: CategoryName;
  region_scope: RegionScope;
  province: Province | null;
  region_district: string | null;
  summary: string | null;
  support_amount: string | null;
  apply_start: string | null;
  apply_end: string | null;
  is_ongoing: boolean;
  source_url: string | null;
  industry?: string; // 라우트에서 병합 후 부여
}

function pick(item: RawItem, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

// HTML 태그 제거 + 기본 엔티티 디코드 + 공백 정리
export function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

// "2026-07-22" | "20260722" | "2026.07.22" → "2026-07-22"
export function toISODate(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  // 실제 달력 날짜만 허용(자유텍스트에서 엉뚱한 숫자를 날짜로 오인하는 것 방지)
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

const ONGOING_HINTS = ["상시", "수시", "소진", "예산", "연중", "별도", "제한없"];

export function parsePeriod(raw: string | null): {
  start: string | null;
  end: string | null;
  ongoing: boolean;
} {
  if (!raw) return { start: null, end: null, ongoing: false };
  const ongoing = ONGOING_HINTS.some((h) => raw.includes(h));
  const parts = raw.split(/[~–]/).map((s) => s.trim());
  const start = toISODate(parts[0] ?? null);
  const end = parts.length > 1 ? toISODate(parts[1] ?? null) : null;
  return { start, end, ongoing: ongoing && !end };
}

function absoluteUrl(u: string | null): string | null {
  if (!u) return null;
  if (u.startsWith("http")) return u;
  return `https://www.bizinfo.go.kr${u.startsWith("/") ? "" : "/"}${u}`;
}

// 지역 범위 판정. null 반환 = 서울·경기와 무관한 타지역 전용 공고(제외).
export function resolveRegion(
  text: string,
  regions: RegionLite[],
  forcedProvince?: Province,
): { scope: RegionScope; province: Province | null; district: string | null } | null {
  // 1) 구체 자치구/시군 매칭 (가장 우선). forcedProvince 있으면 그 광역만.
  for (const r of regions) {
    if (forcedProvince && r.province !== forcedProvince) continue;
    if (text.includes(r.district)) {
      return { scope: "district", province: r.province, district: r.district };
    }
  }

  const hasSeoul = /서울/.test(text);
  const hasGyeonggi = /경기/.test(text);

  // 2) 지역 힌트가 강제된 경우(hashtags=서울/경기 호출)
  if (forcedProvince) {
    return { scope: "province_wide", province: forcedProvince, district: null };
  }

  // 3) 일반(전국) 피드
  if (hasSeoul && !hasGyeonggi)
    return { scope: "province_wide", province: "서울", district: null };
  if (hasGyeonggi && !hasSeoul)
    return { scope: "province_wide", province: "경기", district: null };
  if (hasSeoul && hasGyeonggi)
    return { scope: "national", province: null, district: null }; // 수도권 공통 → 전국 취급

  // 4) 타 광역 전용이면 제외
  if (OTHER_REGION_KEYWORDS.some((k) => text.includes(k))) return null;

  // 5) 지역 언급 없음 → 전국 공통 사업
  return { scope: "national", province: null, district: null };
}

/** 기업마당 API 호출 후 정규화된 프로그램 목록 반환 */
export async function fetchBizinfoPrograms(opts: {
  apiKey: string;
  regions: RegionLite[];
  searchCnt?: number;
  hashtags?: string;
  forcedProvince?: Province;
}): Promise<NormalizedProgram[]> {
  const params = new URLSearchParams({
    crtfcKey: opts.apiKey,
    dataType: "json",
    searchCnt: String(opts.searchCnt ?? 100),
  });
  if (opts.hashtags) params.set("hashtags", opts.hashtags);

  const res = await fetch(`${BIZINFO_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`기업마당 API 오류: HTTP ${res.status} ${res.statusText}`);
  }
  const json: unknown = await res.json();
  const items = extractItems(json);
  return items
    .map((it) => normalizeItem(it, opts.regions, opts.forcedProvince))
    .filter((x): x is NormalizedProgram => x !== null);
}

function extractItems(json: unknown): RawItem[] {
  if (Array.isArray(json)) return json as RawItem[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["jsonArray", "item", "items", "list"]) {
      if (Array.isArray(obj[key])) return obj[key] as RawItem[];
    }
    const body = (obj.response as Record<string, unknown> | undefined)?.body as
      | Record<string, unknown>
      | undefined;
    const nested = (body?.items as Record<string, unknown> | undefined)?.item;
    if (Array.isArray(nested)) return nested as RawItem[];
  }
  return [];
}

function normalizeItem(
  item: RawItem,
  regions: RegionLite[],
  forcedProvince?: Province,
): NormalizedProgram | null {
  const title = pick(item, "pblancNm", "title", "bsnsNm");
  if (!title) return null;

  const externalId =
    pick(item, "pblancId", "pblanc_id", "id", "seq") ?? `bizinfo:${title}`;
  const summary = stripHtml(pick(item, "bsnsSumryCn", "sumry", "cn", "description"));
  const institution =
    pick(item, "excInsttNm", "jrsdInsttNm", "insttNm", "institution");
  const field = pick(item, "pldirSportRealmLclasCodeNm", "pldirSportRealmMlsfcCodeNm", "lclasNm");
  const hashtags = pick(item, "hashtags");
  const periodRaw = pick(item, "reqstBeginEndDe", "reqstDt", "period");
  const url = absoluteUrl(pick(item, "pblancUrl", "url", "detailUrl", "rceptEngnHmpgUrl"));

  const { start, end, ongoing } = parsePeriod(periodRaw);
  const category = classifyCategory(title, summary, field, hashtags);

  // 지역 판정: 제목·해시태그·기관명 위주(요약 본문은 오탐 많아 제외)
  const region = resolveRegion(
    `${title} ${hashtags ?? ""} ${institution ?? ""}`,
    regions,
    forcedProvince,
  );
  if (!region) return null; // 타지역 전용 공고 제외

  return {
    external_id: externalId,
    title,
    institution_name: institution,
    category_name: category,
    region_scope: region.scope,
    province: region.province,
    region_district: region.district,
    summary,
    support_amount: null,
    apply_start: start,
    apply_end: end,
    is_ongoing: ongoing,
    source_url: url,
  };
}
