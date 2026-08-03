// 과학기술정보통신부_사업공고 오픈API 어댑터 (data.go.kr 15074634)
// NIPA(정보통신산업진흥원)는 과기정통부 산하 → 이 API로 ICT/AI/SW 공고를 커버한다.
//
// 엔드포인트: https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList
//   serviceKey(=data.go.kr 계정키, K-Startup·보조금24와 공유), pageNo, numOfRows, type=json
//
// 응답 필드명은 배포 환경에서 원본을 읽어 확정한다(fetchNipaRaw).

import { classifyCategory } from "./categories";
import {
  NormalizedProgram,
  RegionLite,
  resolveRegion,
  stripHtml,
  toISODate,
} from "./bizinfo";

const NIPA_ENDPOINT =
  "https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList";

type RawItem = Record<string, unknown>;

function pick(item: RawItem, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

// data.go.kr 표준 응답 대응. 실제 확인된 두 형태:
//  type=json      → { header, body:{ items:{ item:[ {..}, .. ] } } }
//  returnType=json→ { response:[ {header}, {body:{ items:[ {item:{..}}, .. ] }} ] }
function unwrapItem(x: unknown): RawItem | null {
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (o.item && typeof o.item === "object" && !Array.isArray(o.item)) {
      return o.item as RawItem;
    }
    return o as RawItem;
  }
  return null;
}

function extractItems(json: unknown): RawItem[] {
  if (Array.isArray(json)) return json as RawItem[];
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;

  // body 후보 수집(최상위 body, 또는 response(객체/배열) 안의 body)
  const bodies: Record<string, unknown>[] = [];
  if (obj.body && typeof obj.body === "object") bodies.push(obj.body as Record<string, unknown>);
  const resp = obj.response;
  if (Array.isArray(resp)) {
    for (const part of resp) {
      const b = (part as Record<string, unknown>)?.body;
      if (b && typeof b === "object") bodies.push(b as Record<string, unknown>);
    }
  } else if (resp && typeof resp === "object") {
    const b = (resp as Record<string, unknown>).body;
    if (b && typeof b === "object") bodies.push(b as Record<string, unknown>);
  }

  for (const body of bodies) {
    const items = body.items;
    if (Array.isArray(items)) {
      return items.map(unwrapItem).filter((x): x is RawItem => x !== null);
    }
    if (items && typeof items === "object") {
      const it = (items as Record<string, unknown>).item;
      if (Array.isArray(it)) return it.map(unwrapItem).filter((x): x is RawItem => x !== null);
      if (it && typeof it === "object") return [it as RawItem];
    }
  }
  // 평탄 변형 폴백
  for (const key of ["items", "item", "data", "list"]) {
    if (Array.isArray(obj[key])) return obj[key] as RawItem[];
  }
  return [];
}

interface RawRes {
  status: number;
  ok: boolean;
  text: string;
}

async function callNipa(
  apiKey: string,
  pageNo: number,
  numOfRows: number,
  formatKey: string,
): Promise<RawRes> {
  const params = new URLSearchParams({
    pageNo: String(pageNo),
    numOfRows: String(numOfRows),
  });
  params.set(formatKey, "json");
  // serviceKey 는 이미 인코딩된 값일 수 있어 직접 붙인다(이중 인코딩 방지).
  const url = `${NIPA_ENDPOINT}?serviceKey=${apiKey}&${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, text };
}

/** 진단: 응답 형식·필드명 확인(포맷 파라미터 이름 후보 시도). DB 미적재. */
export const NIPA_BUILD_TAG = "nipa-v1-raw";

export async function fetchNipaRaw(apiKey: string): Promise<{
  buildTag: string;
  variants: unknown[];
}> {
  const probes = [
    { name: "type=json", formatKey: "type" },
    { name: "returnType=json", formatKey: "returnType" },
    { name: "dataType=json", formatKey: "dataType" },
  ];
  const variants: unknown[] = [];
  for (const p of probes) {
    try {
      const r = await callNipa(apiKey, 1, 10, p.formatKey);
      let items: RawItem[] = [];
      try {
        items = extractItems(JSON.parse(r.text));
      } catch {
        /* 비JSON(xml) */
      }
      variants.push({
        variant: p.name,
        status: r.status,
        itemCount: items.length,
        firstItemKeys: items[0] ? Object.keys(items[0]) : [],
        firstItem: items[0] ?? null,
        sample: r.text.slice(0, 1200),
      });
    } catch (e) {
      variants.push({
        variant: p.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { buildTag: NIPA_BUILD_TAG, variants };
}

// ── 정규화 ───────────────────────────────────────────────
// 실제 필드: subject(제목)·viewUrl(링크)·deptName(부서)·pressDt(게시일). 접수기간 없음.
// 이 피드는 과기정통부 보도자료성 공고라 대부분 선정결과·발표·규정개정 → 접수성만 선별.

// 접수/모집을 뜻하는 신호(있어야 채택)
const OPEN_RE =
  /모집|접수|신청|공모|참여기업|수요조사|참가기업|참여기관|모집공고|재공고|모집\s?연장|접수\s?연장/;
// 결과·행정성 공고(있으면 제외) — 접수 신호가 있어도 결과류면 뺀다
const SKIP_RE =
  /선정\s?결과|선정결과|결과\s?공고|결과\s?발표|최종\s?선정|선정기업|선정\s?계획|평가\s?결과|합격|명단|당첨|개정|폐지|규정|훈령|고시|공고문\s?정정|정정\s?공고|낙찰|계약\s?체결|사업\s?종료|폐강/;

function isOpenAnnouncement(subject: string): boolean {
  if (SKIP_RE.test(subject)) return false;
  return OPEN_RE.test(subject);
}

/** viewUrl 의 nttSeqNo(고유 게시번호)를 external_id 로 사용. */
function extractSeq(url: string | null, fallback: string): string {
  if (url) {
    const m = url.match(/nttSeqNo=(\d+)/) ?? url.match(/bbsSeqNo=(\d+)/);
    if (m) return m[1];
  }
  return fallback;
}

function nipaNormalize(
  item: RawItem,
  regions: RegionLite[],
  cutoffISO: string,
): NormalizedProgram | null {
  const title = pick(item, "subject", "pblancNm", "title", "sj", "ancmNm");
  if (!title) return null;

  // 접수성 공고만(결과·행정성 제외)
  if (!isOpenAnnouncement(title)) return null;

  const url = pick(item, "viewUrl", "pblancUrl", "url", "detailUrl");
  const press = toISODate(pick(item, "pressDt", "regDt", "frstRegistDt"));
  // 접수기간이 없으므로 게시일 신선도로 오래된 공고 배제
  if (press && press < cutoffISO) return null;

  const id = extractSeq(url, title);
  const dept = pick(item, "deptName", "deptNm", "jrsdInsttNm");
  const category = classifyCategory(title, dept);
  // 중앙부처(과기정통부) 전국 공고 → 지역 힌트 있으면 반영, 없으면 전국.
  const region = resolveRegion(`${title} ${dept ?? ""}`, regions);
  if (!region) return null; // 타지역 전용 표기가 있으면 제외

  return {
    external_id: `nipa:${id}`,
    title,
    institution_name: dept ? `과학기술정보통신부 ${dept}` : "과학기술정보통신부",
    category_name: category,
    region_scope: region.scope,
    province: region.province,
    region_district: region.district,
    summary: null,
    support_amount: null,
    apply_start: null,
    apply_end: null, // 접수기간 미제공 → 상시 취급(게시일 신선도로 관리)
    is_ongoing: true,
    source_url: url,
  };
}

/** 게시일 신선도 컷오프(오늘-days)의 ISO 날짜. */
function cutoffDate(days: number): string {
  return new Date(Date.now() + 9 * 3600 * 1000 - days * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** 과기정통부 사업공고 조회 후 접수성만 정규화. 다중 페이지 수집. */
export async function fetchNipaPrograms(opts: {
  apiKey: string;
  regions: RegionLite[];
  pages?: number;
  numOfRows?: number;
  freshnessDays?: number;
}): Promise<NormalizedProgram[]> {
  const cutoff = cutoffDate(opts.freshnessDays ?? 45);
  const numOfRows = opts.numOfRows ?? 100;
  const pages = opts.pages ?? 3;
  const byId = new Map<string, NormalizedProgram>();
  for (let page = 1; page <= pages; page++) {
    const r = await callNipa(opts.apiKey, page, numOfRows, "type");
    if (!r.ok) throw new Error(`NIPA(과기정통부) API 오류: HTTP ${r.status}`);
    let json: unknown = null;
    try {
      json = JSON.parse(r.text);
    } catch {
      throw new Error(`NIPA 비JSON 응답: ${r.text.slice(0, 160)}`);
    }
    const items = extractItems(json);
    if (items.length === 0) break; // 더 이상 데이터 없음
    for (const it of items) {
      const n = nipaNormalize(it, opts.regions, cutoff);
      if (n) byId.set(n.external_id, n);
    }
  }
  return [...byId.values()];
}

/** 진단: 정규화(접수성 선별) 결과 카운트/샘플. DB 미적재. */
export async function fetchNipaDiag(
  apiKey: string,
  regions: RegionLite[],
): Promise<{ total: number; kept: number; sample: NormalizedProgram[] }> {
  const cutoff = cutoffDate(45);
  const r = await callNipa(apiKey, 1, 100, "type");
  const json = JSON.parse(r.text);
  const items = extractItems(json);
  const kept = items
    .map((it) => nipaNormalize(it, regions, cutoff))
    .filter((x): x is NormalizedProgram => x !== null);
  return { total: items.length, kept: kept.length, sample: kept.slice(0, 12) };
}
