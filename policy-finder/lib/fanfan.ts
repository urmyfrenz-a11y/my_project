// 판판대로(fanfandaero.kr) 지원사업 공고 어댑터
//
// 소상공인·중소기업 판로/유통 지원사업 통합 플랫폼(중기부/소진공).
//   POST https://fanfandaero.kr/portal/v2/selectSprtBizPbancList.do  (form-urlencoded)
//   body: pageIndex, pageUnit, searchText(검색어; 비우면 전체), searchAreaStr(지역),
//         searchTargetStr(대상), searchTypeStr, searchOrder=1, ...
//   헤더: X-Requested-With, Sec-Fetch-*, Content-Type form-urlencoded
//
// 응답: { sprtBizApplList:[ { sprtBizNm(제목), sprtBizCd(ID), rcritBgngYmd,
//         rcritEndYmd, jrsdInsttNm/operInstNm(기관), sprtBizCtpvNm(시도) } ] }

import { classifyCategory } from "./categories";
import {
  NormalizedProgram,
  RegionLite,
  resolveRegion,
  toISODate,
} from "./bizinfo";

const FANFAN_LIST = "https://fanfandaero.kr/portal/v2/selectSprtBizPbancList.do";
const FANFAN_PAGE =
  "https://fanfandaero.kr/portal/v2/preSprtBizPbanc.do?moveType=intro_sb";

function fanfanHeaders(cookie?: string, form = true): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    Origin: "https://fanfandaero.kr",
    Referer: FANFAN_PAGE,
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
    const res = await fetch(FANFAN_PAGE, {
      headers: fanfanHeaders(undefined, false),
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

export interface FanfanForm {
  pageIndex?: number;
  pageUnit?: number;
  searchText?: string;
  searchAreaStr?: string;
  searchTargetStr?: string;
  searchTypeStr?: string;
}

function buildForm(p: FanfanForm): string {
  const params = new URLSearchParams();
  params.set("brno", "");
  params.set("pageIndex", String(p.pageIndex ?? 1));
  params.set("pageUnit", String(p.pageUnit ?? 100));
  params.set("searchTypeStr", p.searchTypeStr ?? "");
  params.set("searchTargetStr", p.searchTargetStr ?? "");
  params.set("searchAreaStr", p.searchAreaStr ?? "");
  params.set("searchText", p.searchText ?? "");
  params.set("noSearchSprt", "");
  params.set("searchOrder", "1");
  params.set("sortOrder", "");
  params.set("testLoginId", "");
  params.set("notSearchSprtBizCd", "");
  return params.toString();
}

interface RawRes {
  status: number;
  ok: boolean;
  contentType: string | null;
  text: string;
}

async function callFanfan(form: string, cookie?: string): Promise<RawRes> {
  const res = await fetch(FANFAN_LIST, {
    method: "POST",
    headers: fanfanHeaders(cookie, true),
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
export const FANFAN_BUILD_TAG = "fanfan-v1-raw";

export async function fetchFanfanRaw(): Promise<{
  buildTag: string;
  session: string;
  variants: unknown[];
}> {
  const cookie = await fetchSession();
  const probes: { name: string; form: string; cookie?: string }[] = [
    { name: "all-session", form: buildForm({ pageUnit: 10 }), cookie: cookie ?? undefined },
    { name: "all-nocookie", form: buildForm({ pageUnit: 10 }) },
  ];
  const variants: unknown[] = [];
  for (const p of probes) {
    try {
      const r = await callFanfan(p.form, p.cookie);
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
    buildTag: FANFAN_BUILD_TAG,
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
    const v = (json as Record<string, unknown>).sprtBizApplList;
    if (Array.isArray(v)) return v as RawItem[];
  }
  return [];
}

function fanfanNormalize(item: RawItem, regions: RegionLite[]): NormalizedProgram | null {
  const title = pick(item, "sprtBizNm");
  if (!title) return null;
  const code = pick(item, "sprtBizCd") ?? title;

  const start = toISODate(pick(item, "rcritBgngYmd", "pbancRlsBgngYmd"));
  const end = toISODate(pick(item, "rcritEndYmd", "pbancRlsEndYmd"));
  const inst = pick(item, "jrsdInsttNm", "operInstNm");
  const ctpv = pick(item, "sprtBizCtpvNm");
  const category = classifyCategory(title, pick(item, "sprtBizTyNm"));

  // 판판대로는 판로 통합(전국 중심). 지역 표기 있으면 반영, 없으면 전국.
  const region = resolveRegion(`${ctpv ?? ""} ${title} ${inst ?? ""}`, regions);
  if (!region) return null; // 타지역 전용 제외

  return {
    external_id: `fanfan:${code}`,
    title,
    institution_name: inst ?? "소상공인시장진흥공단",
    category_name: category,
    region_scope: region.scope,
    province: region.province,
    region_district: region.district,
    summary: null,
    support_amount: null,
    apply_start: start,
    apply_end: end,
    is_ongoing: !end && !start,
    source_url: `https://fanfandaero.kr/portal/v2/preSprtBizPbancDetail.do?sprtBizCd=${code}`,
  };
}

/** 판판대로 지원사업 조회 후 정규화. */
export async function fetchFanfanPrograms(opts: {
  regions: RegionLite[];
  pageUnit?: number;
}): Promise<NormalizedProgram[]> {
  const cookie = await fetchSession();
  const r = await callFanfan(buildForm({ pageUnit: opts.pageUnit ?? 200 }), cookie ?? undefined);
  if (!r.ok) throw new Error(`판판대로 API 오류: HTTP ${r.status}`);
  const json = JSON.parse(r.text);
  return extractItems(json)
    .map((it) => fanfanNormalize(it, opts.regions))
    .filter((x): x is NormalizedProgram => x !== null);
}
