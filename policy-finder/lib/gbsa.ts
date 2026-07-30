// GBSA(경기도경제과학진흥원) G-PMS 사업공고 어댑터
//
// 사업공고 목록 내부 AJAX 엔드포인트를 사용한다.
//   POST https://pms.gbsa.or.kr/info/pblanc/pblancListAjax.do  (form-urlencoded)
//   응답: { data:[ { busiNm(제목), anncNo(공고번호), expnItmOrgnNo, reptStrDt,
//          reptEndDt, reptDt(기간문자열), busiClsNm(분류), anncDt, busiYy } ] }
//   모두 경기도 사업(경기경제과학진흥원) → 경기로 태깅.

import { classifyCategory } from "./categories";
import {
  NormalizedProgram,
  RegionLite,
  parsePeriod,
  resolveRegion,
  toISODate,
} from "./bizinfo";

const GBSA_LIST = "https://pms.gbsa.or.kr/info/pblanc/pblancListAjax.do";
const GBSA_PAGE = "https://pms.gbsa.or.kr/info/pblanc/pblancList.do";

function gbsaHeaders(cookie?: string, form = true): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    Origin: "https://pms.gbsa.or.kr",
    Referer: GBSA_PAGE,
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

async function fetchSession(): Promise<string | null> {
  try {
    const res = await fetch(GBSA_PAGE, {
      headers: gbsaHeaders(undefined, false),
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

export interface GbsaForm {
  pageIndex?: number;
  pageunit?: number;
  searchKeyword?: string;
}

function buildForm(p: GbsaForm): string {
  const inner = {
    pageIndex: String(p.pageIndex ?? 1),
    pageunit: String(p.pageunit ?? 100),
    prevTp: "",
    chkStat: "",
    pageType: "list",
    anncNo: "",
    schDetailAnnc: "",
    searchCondition: "all",
    searchKeyword: p.searchKeyword ?? "",
    ozcsrf: "",
  };
  const params = new URLSearchParams();
  params.set("pageindex", String(p.pageIndex ?? 1));
  params.set("pageunit", String(p.pageunit ?? 100));
  params.set("param", JSON.stringify(inner));
  return params.toString();
}

interface RawRes {
  status: number;
  ok: boolean;
  contentType: string | null;
  text: string;
}

async function callGbsa(form: string, cookie?: string): Promise<RawRes> {
  const res = await fetch(GBSA_LIST, {
    method: "POST",
    headers: gbsaHeaders(cookie, true),
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

/** 진단: 응답 형식(JSON/HTML)·세션 필요 여부·전체조회 확인. DB 미적재. */
export const GBSA_BUILD_TAG = "gbsa-v1-raw";

export async function fetchGbsaRaw(): Promise<{
  buildTag: string;
  session: string;
  variants: unknown[];
}> {
  const cookie = await fetchSession();
  const probes: { name: string; form: string; cookie?: string }[] = [
    { name: "all-session", form: buildForm({ pageunit: 10 }), cookie: cookie ?? undefined },
    { name: "all-nocookie", form: buildForm({ pageunit: 10 }) },
  ];
  const variants: unknown[] = [];
  for (const p of probes) {
    try {
      const r = await callGbsa(p.form, p.cookie);
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
    buildTag: GBSA_BUILD_TAG,
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
    const d = (json as Record<string, unknown>).data;
    if (Array.isArray(d)) return d as RawItem[];
  }
  return [];
}

function gbsaNormalize(item: RawItem, regions: RegionLite[]): NormalizedProgram | null {
  const title = pick(item, "busiNm", "anncNm", "projNm");
  if (!title) return null;

  const anncNo = pick(item, "anncNo") ?? "";
  const orgn = pick(item, "expnItmOrgnNo") ?? "";
  const externalId = `gbsa:${anncNo}_${orgn}` || `gbsa:${title}`;

  let start = toISODate(pick(item, "reptStrDt"));
  let end = toISODate(pick(item, "reptEndDt"));
  if (!start && !end) {
    const p = parsePeriod(pick(item, "reptDt"));
    start = p.start;
    end = p.end;
  }

  const category = classifyCategory(title, pick(item, "busiClsNm"));
  // GBSA = 경기경제과학진흥원 → 경기. 제목에 시군 있으면 자치구, 없으면 경기 광역.
  const region =
    resolveRegion(`${title}`, regions, "경기") ??
    { scope: "province_wide" as const, province: "경기" as const, district: null };

  return {
    external_id: externalId,
    title,
    institution_name: "경기도경제과학진흥원",
    category_name: category,
    region_scope: region.scope,
    province: region.province,
    region_district: region.district,
    summary: null,
    support_amount: null,
    apply_start: start,
    apply_end: end,
    is_ongoing: !end && !start,
    source_url: anncNo
      ? `https://pms.gbsa.or.kr/info/pblanc/pblancView.do?anncNo=${anncNo}&expnItmOrgnNo=${orgn}`
      : "https://pms.gbsa.or.kr/info/pblanc/pblancList.do",
  };
}

/** GBSA 사업공고 조회 후 정규화(모두 경기). */
export async function fetchGbsaPrograms(opts: {
  regions: RegionLite[];
  pageunit?: number;
}): Promise<NormalizedProgram[]> {
  const cookie = await fetchSession();
  const r = await callGbsa(
    buildForm({ pageIndex: 1, pageunit: opts.pageunit ?? 200 }),
    cookie ?? undefined,
  );
  if (!r.ok) throw new Error(`GBSA API 오류: HTTP ${r.status}`);
  const json = JSON.parse(r.text);
  return extractItems(json)
    .map((it) => gbsaNormalize(it, opts.regions))
    .filter((x): x is NormalizedProgram => x !== null);
}
