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

// data.go.kr 표준 응답(response.body.items.item[]) 및 평탄 변형 모두 대응.
function extractItems(json: unknown): RawItem[] {
  if (Array.isArray(json)) return json as RawItem[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["items", "item", "data", "list"]) {
      if (Array.isArray(obj[key])) return obj[key] as RawItem[];
    }
    const body = (obj.response as Record<string, unknown> | undefined)?.body as
      | Record<string, unknown>
      | undefined;
    if (body) {
      if (Array.isArray(body.items)) return body.items as RawItem[];
      const nested = (body.items as Record<string, unknown> | undefined)?.item;
      if (Array.isArray(nested)) return nested as RawItem[];
      if (nested && typeof nested === "object") return [nested as RawItem];
    }
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

// ── 정규화(필드명 확정 후 채움) ──────────────────────────
// 필드 후보를 넓게 두고, 제목 없으면 제외. 배포 후 fetchNipaRaw 로 실제 키 확인해 조정.
function nipaNormalize(
  item: RawItem,
  regions: RegionLite[],
): NormalizedProgram | null {
  const title = pick(
    item,
    "pblancNm",
    "bsnsNm",
    "announcementNm",
    "title",
    "sj",
    "ancmNm",
    "bizNm",
  );
  if (!title) return null;

  const id = pick(item, "pblancId", "ancmId", "id", "seq", "bsnsId") ?? title;
  const summary = stripHtml(pick(item, "cn", "bsnsSumryCn", "cont", "dtlCn"));
  const institution = pick(
    item,
    "jrsdInsttNm",
    "insttNm",
    "excInsttNm",
    "orgNm",
    "deptNm",
  );
  const begin = pick(item, "reqstBeginDe", "aplyBgngDe", "rceptBgngDe", "beginDe");
  const endRaw = pick(item, "reqstEndDe", "aplyEndDe", "rceptEndDe", "endDe");
  const url = pick(item, "pblancUrl", "url", "detailUrl", "linkUrl");

  const start = toISODate(begin);
  const end = toISODate(endRaw);
  const category = classifyCategory(title, summary);
  const region = resolveRegion(`${title} ${institution ?? ""}`, regions);
  if (!region) return null;

  return {
    external_id: `nipa:${id}`,
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
    is_ongoing: !end && !start,
    source_url: url,
  };
}

/** 과기정통부 사업공고 조회 후 정규화. formatKey 는 raw 진단으로 확정한 값 사용. */
export async function fetchNipaPrograms(opts: {
  apiKey: string;
  regions: RegionLite[];
  numOfRows?: number;
  formatKey?: string;
}): Promise<NormalizedProgram[]> {
  const r = await callNipa(opts.apiKey, 1, opts.numOfRows ?? 100, opts.formatKey ?? "type");
  if (!r.ok) throw new Error(`NIPA(과기정통부) API 오류: HTTP ${r.status}`);
  let json: unknown = null;
  try {
    json = JSON.parse(r.text);
  } catch {
    throw new Error(`NIPA 비JSON 응답: ${r.text.slice(0, 160)}`);
  }
  return extractItems(json)
    .map((it) => nipaNormalize(it, opts.regions))
    .filter((x): x is NormalizedProgram => x !== null);
}
