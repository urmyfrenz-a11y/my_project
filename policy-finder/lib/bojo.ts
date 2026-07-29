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

// 스타트업·소상공인 대상 판별 (고정밀)
// 반드시 엔티티 유형 키워드(INCLUDE)가 있어야 하고, 무관 도메인(EXCLUDE)이면 제외.
const INCLUDE =
  /소상공인|소공인|소상인|자영업|소기업|중소기업|1인\s?기업|스타트업|벤처기업|예비창업|창업기업|창업자|창업중심|창업\s?지원|점포|상점가|전통시장|소셜벤처|소상공|온라인\s?셀러/;
const EXCLUDE =
  /농업|농촌|농어|임업|산림|수산|축산|어업|어촌|귀농|귀어|양식업|영농|보훈|국가유공|참전|수계\s?주민|주민지원사업|자활|기초생활|차상위|다문화|보육|아동|청소년|노인|고령자\s?고용|장애인복지|여성가족|이재민|재해복구|산불|일자리도약|취업\s?알선|구직/;
const BIZ_USER_STRONG = /소상공인|창업|스타트업|벤처/;

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
  let scanned = 0;
  const userTypes = new Set<string>();

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
      break;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`보조금24 비JSON 응답(page ${page}): ${text.slice(0, 200)}`);
    }
    const items = extractItems(json);
    if (page === 1 && items.length === 0) {
      throw new Error(`보조금24 데이터 없음(page 1): ${text.slice(0, 220)}`);
    }
    scanned += items.length;
    for (const it of items) {
      const u = (it as Record<string, unknown>)["사용자구분"];
      if (typeof u === "string") userTypes.add(u);
      const n = normalizeItem(it, opts.regions);
      if (n) out.push(n);
    }
    if (items.length < perPage) break;
  }

  // 전량 스캔했는데 0건이면 진단 정보를 에러로 노출(배포/필터 원인 구분용)
  if (out.length === 0) {
    throw new Error(
      `보조금24 필터 후 0건 — scanned=${scanned}, 사용자구분값=[${[...userTypes].join(", ")}]`,
    );
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

  // 고정밀 필터: (엔티티 유형 키워드 or 사용자구분 강신호) AND 무관 도메인 아님
  const haystack = `${title} ${summary ?? ""} ${target ?? ""} ${field ?? ""}`;
  const included = INCLUDE.test(haystack) || BIZ_USER_STRONG.test(userType);
  if (!included || EXCLUDE.test(haystack)) return null;

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
