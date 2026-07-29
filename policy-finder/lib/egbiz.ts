// 경기기업비서(egbiz.or.kr) 지원사업 어댑터
//
// 프런트가 호출하는 내부 AJAX 엔드포인트를 사용한다(세션 불필요, 브라우저 헤더만).
//   POST https://www.egbiz.or.kr/sp/selectSupportPrjListAjax.do  (form-urlencoded)
//   body: pageIndex, bizNm(검색어), areaCode(지역코드; 비우면 전체), categoryId,
//         sortCd=bizCyclId, prjStatus=all, gginsttYn=Y, part=area
//   응답: { result:true, value:[ { bizNm(제목), bizCyclId(ID/상세), aplyBgngDt,
//          aplyEndDt, outsdInstNm(주관기관), categoryNm, prjStatus, ... } ] }
//   recordCountPerPage=10000 → 한 번에 대량 반환.
//
// egbiz는 기업마당도 흡수하므로, 여기서는 "경기 지자체 사업"만 선별하고
// 기업마당 재중계분(bizinfo 중복)은 제외한다.

import { classifyCategory } from "./categories";
import {
  NormalizedProgram,
  RegionLite,
  resolveRegion,
  stripHtml,
  toISODate,
} from "./bizinfo";

const EGBIZ_LIST = "https://www.egbiz.or.kr/sp/selectSupportPrjListAjax.do";
const EGBIZ_PAGE = "https://www.egbiz.or.kr/sp/supportPrjAreaList.do";

function egbizHeaders(cookie?: string, form = true): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    Origin: "https://www.egbiz.or.kr",
    Referer: EGBIZ_PAGE,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Requested-With": "XMLHttpRequest",
    "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };
  if (form) h["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  if (cookie) h["Cookie"] = cookie;
  return h;
}

// 목록 페이지 GET → Set-Cookie 에서 JSESSIONID 획득(세션 필요 대비).
async function fetchSession(): Promise<string | null> {
  try {
    const res = await fetch(EGBIZ_PAGE, {
      headers: egbizHeaders(undefined, false),
      cache: "no-store",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const m = setCookie.match(/JSESSIONID=[^;]+/);
      if (m) return m[0];
    }
  } catch {
    /* 세션 없이도 시도 */
  }
  return null;
}

export interface EgbizForm {
  pageIndex?: number;
  bizNm?: string;
  areaCode?: string;
  categoryId?: string;
  prjStatus?: string;
  gginsttYn?: string;
  part?: string;
}

function buildForm(p: EgbizForm): string {
  const params = new URLSearchParams();
  params.set("pageIndex", String(p.pageIndex ?? 0));
  params.set("bizNm", p.bizNm ?? "");
  params.set("areaCode", p.areaCode ?? "");
  params.set("categoryId", p.categoryId ?? "");
  params.set("sortCd", "bizCyclId");
  params.set("prjStatus", p.prjStatus ?? "all");
  params.set("gginsttYn", p.gginsttYn ?? "Y");
  params.set("part", p.part ?? "area");
  return params.toString();
}

interface RawRes {
  status: number;
  ok: boolean;
  contentType: string | null;
  text: string;
}

async function callEgbiz(form: string, cookie?: string): Promise<RawRes> {
  const res = await fetch(EGBIZ_LIST, {
    method: "POST",
    headers: egbizHeaders(cookie, true),
    body: form,
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  return {
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get("content-type"),
    text,
  };
}

/** 진단: 응답이 JSON인지 HTML인지, 세션 필요한지, 빈 areaCode로 전체를 받는지 확인. */
export const EGBIZ_BUILD_TAG = "egbiz-v1-raw";

export async function fetchEgbizRaw(): Promise<{
  buildTag: string;
  session: string;
  variants: unknown[];
}> {
  const cookie = await fetchSession();
  const probes: { name: string; form: string; cookie?: string }[] = [
    { name: "yongin-111-session", form: buildForm({ areaCode: "111" }), cookie: cookie ?? undefined },
    { name: "yongin-111-nocookie", form: buildForm({ areaCode: "111" }) },
    { name: "all-area-empty-session", form: buildForm({ areaCode: "" }), cookie: cookie ?? undefined },
  ];
  const variants: unknown[] = [];
  for (const p of probes) {
    try {
      const r = await callEgbiz(p.form, p.cookie);
      variants.push({
        variant: p.name,
        status: r.status,
        contentType: r.contentType,
        length: r.text.length,
        sample: r.text.slice(0, 2500),
      });
    } catch (e) {
      variants.push({
        variant: p.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    buildTag: EGBIZ_BUILD_TAG,
    session: cookie ? "got-session" : "no-session",
    variants,
  };
}

// ── 정규화 ──────────────────────────────────────────────
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
    const v = (json as Record<string, unknown>).value;
    if (Array.isArray(v)) return v as RawItem[];
  }
  return [];
}

function egbizNormalize(
  item: RawItem,
  regions: RegionLite[],
): NormalizedProgram | null {
  const title = pick(item, "bizNm", "prjtNm");
  if (!title) return null;

  // 기업마당 재중계분은 제외(우리 bizinfo가 이미 커버 → 중복 방지)
  const inst = pick(item, "outsdInstNm", "insttNm");
  if (inst && inst.includes("기업마당")) return null;

  const id = pick(item, "bizCyclId", "prjtId") ?? title;
  const category = classifyCategory(title, pick(item, "categoryNm"));
  const start = toISODate(pick(item, "aplyBgngDt"));
  const end = toISODate(pick(item, "aplyEndDt"));

  // 지역 판정: 제목·기관 텍스트로. egbiz는 경기 포털이므로 "경기"만 채택.
  const region = resolveRegion(`${title} ${inst ?? ""}`, regions);
  if (!region || region.province !== "경기") return null; // 경기 지자체 사업만

  return {
    external_id: `egbiz:${id}`,
    title,
    institution_name: inst,
    category_name: category,
    region_scope: region.scope,
    province: region.province,
    region_district: region.district,
    summary: stripHtml(pick(item, "pbancCn")),
    support_amount: null,
    apply_start: start,
    apply_end: end,
    is_ongoing: !end,
    source_url: `https://www.egbiz.or.kr/sp/supportPrjDtl.do?bizCyclId=${id}`,
  };
}

/** 경기기업비서 지원사업 조회 후 "경기" 사업만 정규화. */
export async function fetchEgbizPrograms(opts: {
  regions: RegionLite[];
  maxPages?: number;
}): Promise<NormalizedProgram[]> {
  const maxPages = opts.maxPages ?? 3;
  const byId = new Map<string, NormalizedProgram>();

  for (let page = 0; page < maxPages; page++) {
    const r = await callEgbiz(buildForm({ pageIndex: page, areaCode: "" }));
    if (!r.ok) {
      if (page === 0) throw new Error(`egbiz API 오류: HTTP ${r.status}`);
      break;
    }
    let json: unknown = null;
    try {
      json = JSON.parse(r.text);
    } catch {
      throw new Error(`egbiz 비JSON 응답(page ${page})`);
    }
    const items = extractItems(json);
    if (items.length === 0) break;
    for (const it of items) {
      const n = egbizNormalize(it, opts.regions);
      if (n) byId.set(n.external_id, n);
    }
    if (items.length < 10) break; // 더 이상 페이지 없음(pageUnit 기준)
  }
  return [...byId.values()];
}

/** 진단: 정규화 결과 카운트/샘플(경기 선별 후). DB 미적재. */
export async function fetchEgbizDiag(regions: RegionLite[]): Promise<{
  buildTag: string;
  totalFetched: number;
  keptGyeonggi: number;
  scopeBreakdown: Record<string, number>;
  sample: NormalizedProgram[];
}> {
  const r = await callEgbiz(buildForm({ pageIndex: 0, areaCode: "" }));
  const json = JSON.parse(r.text);
  const items = extractItems(json);
  const kept: NormalizedProgram[] = [];
  for (const it of items) {
    const n = egbizNormalize(it, regions);
    if (n) kept.push(n);
  }
  const scopeBreakdown: Record<string, number> = {};
  for (const k of kept) {
    const key = `${k.region_scope}:${k.province ?? ""}`;
    scopeBreakdown[key] = (scopeBreakdown[key] ?? 0) + 1;
  }
  return {
    buildTag: EGBIZ_BUILD_TAG,
    totalFetched: items.length,
    keptGyeonggi: kept.length,
    scopeBreakdown,
    sample: kept.slice(0, 6),
  };
}
