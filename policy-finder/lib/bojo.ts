// 보조금24 (행정안전부_대한민국 공공서비스(혜택) 정보) 어댑터
// odcloud: https://api.odcloud.kr/api/gov24/v3/serviceList
//   serviceKey, page, perPage, returnType=JSON, cond[필드::OP]=값
// 응답: { currentCount, data: [ {서비스ID, 서비스명, 서비스목적요약, 서비스분야,
//   소관기관명, 신청기한, 상세조회URL, 사용자구분, 지원대상, 지원내용 ...} ] }
//
// 보조금24는 대부분 복지·개인 혜택 → '사용자구분'이 기업/소상공인이거나
// 소상공인 키워드가 있는 것만 통과시킨다.

import { classifyCategory } from "./categories";
import {
  NormalizedProgram,
  RegionLite,
  parsePeriod,
  resolveRegion,
  stripHtml,
} from "./bizinfo";

const BOJO_ENDPOINT = "https://api.odcloud.kr/api/gov24/v3/serviceList";

// 소상공인/기업 대상 판별
const BIZ_USER = /기업|소상공인|자영|법인|사업자/;
const BIZ_KEYWORDS =
  /소상공인|자영업|소기업|중소기업|사업자|점포|상인|상점가|전통시장|창업/;

type RawItem = Record<string, unknown>;

function pick(item: RawItem, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function extractItems(json: unknown): RawItem[] {
  if (json && typeof json === "object") {
    const d = (json as Record<string, unknown>).data;
    if (Array.isArray(d)) return d as RawItem[];
  }
  return [];
}

/** 보조금24 호출 후 소상공인/기업 대상만 정규화.
 *  cond(한글 필드) 없이 여러 페이지를 받아 클라이언트에서 필터한다. */
export async function fetchBojoPrograms(opts: {
  apiKey: string;
  regions: RegionLite[];
  perPage?: number;
  maxPages?: number;
}): Promise<NormalizedProgram[]> {
  const perPage = opts.perPage ?? 100;
  const maxPages = opts.maxPages ?? 12; // 1,075건 ≈ 11페이지 → 전량 스캔
  const out: NormalizedProgram[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
      returnType: "JSON",
    });
    const url = `${BOJO_ENDPOINT}?serviceKey=${opts.apiKey}&${params.toString()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) {
      if (page === 1) throw new Error(`보조금24 API 오류: HTTP ${res.status}`);
      break; // 이후 페이지 오류는 무시하고 지금까지 것 사용
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`보조금24 비JSON 응답(page ${page}): ${text.slice(0, 200)}`);
    }
    const items = extractItems(json);
    // page 1에서 0건이면 원인 파악용으로 원본 앞부분을 에러에 실어 노출
    if (page === 1 && items.length === 0) {
      throw new Error(`보조금24 데이터 없음(page 1): ${text.slice(0, 220)}`);
    }
    for (const it of items) {
      const n = normalizeItem(it, opts.regions);
      if (n) out.push(n);
    }
    if (items.length < perPage) break; // 마지막 페이지
  }
  return out;
}

function normalizeItem(
  item: RawItem,
  regions: RegionLite[],
): NormalizedProgram | null {
  const title = pick(item, "서비스명");
  if (!title) return null;

  const userType = pick(item, "사용자구분") ?? "";
  const summary = stripHtml(pick(item, "서비스목적요약", "지원내용"));
  const target = pick(item, "지원대상");
  const field = pick(item, "서비스분야");

  // 소상공인/기업 대상만 통과
  const haystack = `${title} ${summary ?? ""} ${target ?? ""} ${field ?? ""}`;
  if (!BIZ_USER.test(userType) && !BIZ_KEYWORDS.test(haystack)) return null;

  const institution = pick(item, "소관기관명");
  const period = parsePeriod(pick(item, "신청기한"));
  const source = pick(item, "상세조회URL");
  const id = pick(item, "서비스ID") ?? title;
  const category = classifyCategory(title, summary, field, target);

  const region = resolveRegion(`${institution ?? ""} ${title}`, regions);
  if (!region) return null;

  return {
    external_id: `bojo:${id}`,
    title,
    institution_name: institution,
    category_name: category,
    region_scope: region.scope,
    province: region.province,
    region_district: region.district,
    summary,
    support_amount: null,
    apply_start: period.start,
    apply_end: period.end,
    is_ongoing: period.ongoing,
    source_url: source,
  };
}
