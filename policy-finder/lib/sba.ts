// 서울경제진흥원(SBA) 접수중인 사업 어댑터 (HTML 크롤 — 서버렌더링, JSON 없음)
//
//   GET https://www.sba.seoul.kr/Pages/BusinessApply/OngoingList.aspx
//   → 목록 HTML. 각 행에 사업명·접수일정·상세링크(PostingDetail.aspx?mid=<GUID>) 포함.
//
// HTML 파싱: 각 행 <tr class="grid_list tbody"> 안에서 상세링크(mid)·사업명·유형·
// 접수일정을 뽑는다. 모두 서울경제진흥원(SBA) 사업 → 서울로 태깅.

import { classifyCategory } from "./categories";
import {
  NormalizedProgram,
  RegionLite,
  resolveRegion,
  stripHtml,
  toISODate,
} from "./bizinfo";

const SBA_LIST = "https://www.sba.seoul.kr/Pages/BusinessApply/OngoingList.aspx";

function sbaHeaders(cookie?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };
  if (cookie) h.Cookie = cookie;
  return h;
}

interface RawRes {
  status: number;
  ok: boolean;
  text: string;
}

async function callSba(cookie?: string): Promise<RawRes> {
  const res = await fetch(SBA_LIST, { headers: sbaHeaders(cookie), cache: "no-store" });
  const text = await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, text };
}

/** 진단: 목록 HTML 구조 확인. 공고 행(PostingDetail 링크) 주변을 잘라서 보여준다. */
export const SBA_BUILD_TAG = "sba-v1-raw";

export async function fetchSbaRaw(): Promise<{
  buildTag: string;
  status: number;
  length: number;
  postingLinkCount: number;
  titleCellCount: number;
  titleCells: string[];
}> {
  const r = await callSba();
  const postingLinkCount = (r.text.match(/PostingDetail/g) ?? []).length;
  // 실제 제목 셀(class="title text_l ...") 앞부분을 그대로 잘라 내부 구조 확인
  const cells: string[] = [];
  // 제목 셀은 내부에 중첩 <table>이 있어 첫 </td>로는 안 끝남 → 다음 제목셀 시작 전까지 크게 확보
  const starts: number[] = [];
  const startRe = /<td class="title text_l/gi;
  let sm: RegExpExecArray | null;
  while ((sm = startRe.exec(r.text))) starts.push(sm.index);
  for (let i = 0; i < Math.min(2, starts.length); i++) {
    const end = starts[i + 1] ?? starts[i] + 1800;
    cells.push(r.text.slice(starts[i], Math.min(end, starts[i] + 1800)));
  }
  return {
    buildTag: SBA_BUILD_TAG,
    status: r.status,
    length: r.text.length,
    postingLinkCount,
    titleCellCount: (r.text.match(/<td class="title text_l/gi) ?? []).length,
    titleCells: cells,
  };
}

// ── HTML 파서 ───────────────────────────────────────────
const GUID_RE = /mid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function firstMatch(re: RegExp, s: string): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

function sbaParseRow(rowHtml: string, regions: RegionLite[]): NormalizedProgram | null {
  const mid = firstMatch(GUID_RE, rowHtml);
  if (!mid) return null;

  const title = stripHtml(
    firstMatch(/class="title[^"]*"[^>]*>([\s\S]*?)<\/td>/i, rowHtml),
  );
  if (!title) return null;

  const type = stripHtml(
    firstMatch(/class="[^"]*only_pc"[^>]*>([\s\S]*?)<\/td>/i, rowHtml),
  );
  // 접수일정 td 에서 날짜 2개 추출
  const dateCell = firstMatch(/class="[^"]*\bdate\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i, rowHtml) ?? rowHtml;
  const dates = dateCell.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const start = toISODate(dates[0] ?? null);
  const end = toISODate(dates[1] ?? null);

  const category = classifyCategory(title, type);
  const region =
    resolveRegion(title, regions, "서울") ??
    { scope: "province_wide" as const, province: "서울" as const, district: null };

  return {
    external_id: `sba:${mid}`,
    title,
    institution_name: "서울경제진흥원(SBA)",
    category_name: category,
    region_scope: region.scope,
    province: region.province,
    region_district: region.district,
    summary: null,
    support_amount: null,
    apply_start: start,
    apply_end: end,
    is_ongoing: !end && !start,
    source_url: `https://www.sba.seoul.kr/Pages/BusinessApply/PostingDetail.aspx?p=1&mid=${mid}`,
  };
}

/** SBA 접수중인 사업 HTML 파싱 후 정규화(서울). 첫 페이지 기준(약 10건). */
export async function fetchSbaPrograms(opts: {
  regions: RegionLite[];
}): Promise<NormalizedProgram[]> {
  const r = await callSba();
  if (!r.ok) throw new Error(`SBA 페이지 오류: HTTP ${r.status}`);
  // 각 공고 행으로 분할
  const rows = r.text.split(/<tr class="grid_list tbody"/i).slice(1);
  const byId = new Map<string, NormalizedProgram>();
  for (const row of rows) {
    const n = sbaParseRow(row, opts.regions);
    if (n) byId.set(n.external_id, n);
  }
  return [...byId.values()];
}
