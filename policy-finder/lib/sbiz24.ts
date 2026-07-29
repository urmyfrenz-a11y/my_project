// 소상공인24(sbiz24.kr) 통합공고 어댑터
//
// 소상공인24 프런트가 호출하는 내부 JSON API를 그대로 사용한다(인증키 불필요).
//   POST https://www.sbiz24.kr/api/combinePbanc/list
//   body: { startRow, endRow, paging:true, sortModel:[],
//           search:{ regionNmList:["서울","경기"], rcrtTypeCdNmList:[...], ... } }
//   응답: { result:true, data:{ default:{ page:{ ...목록배열... }, total:62, ... } } }
//
// 항목의 정확한 필드명은 배포 환경에서 원본을 읽어 확정한다(fetchSbiz24Raw).
// 그래서 여기서는 후보 키를 넓게 두고(pick), 제목이 없으면 건너뛴다(오염 방지).

import { classifyCategory } from "./categories";
import {
  NormalizedProgram,
  RegionLite,
  parsePeriod,
  resolveRegion,
  stripHtml,
  toISODate,
} from "./bizinfo";

const SBIZ_ENDPOINT = "https://www.sbiz24.kr/api/combinePbanc/list";

type RawItem = Record<string, unknown>;

function pick(item: RawItem, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

// 서울·경기만 조회. 지원대상(rcrtTypeCdNmList)은 비워서 전 대상(소상공인+창업 등)을
// 넓게 받고, 지역/카테고리 판정과 필터는 우리 로직으로 처리한다.
function buildBody(startRow: number, endRow: number) {
  return {
    startRow,
    endRow,
    paging: true,
    sortModel: [],
    search: {
      regionNmList: ["서울", "경기"],
    },
  };
}

async function callSbiz(startRow: number, endRow: number): Promise<unknown> {
  const res = await fetch(SBIZ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Referer: "https://www.sbiz24.kr/",
      Origin: "https://www.sbiz24.kr",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
    body: JSON.stringify(buildBody(startRow, endRow)),
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`소상공인24 API 오류: HTTP ${res.status} ${t.slice(0, 160)}`);
  }
  return res.json();
}

// data.default 내부에서 실제 목록 배열을 찾아 반환(키 이름이 불확실해도 대응).
function extractItems(json: unknown): RawItem[] {
  const found = findFirstObjectArray(json, 0);
  return found ?? [];
}

// 객체 트리를 얕게 훑어 "객체들의 배열"을 처음 만나면 반환.
function findFirstObjectArray(node: unknown, depth: number): RawItem[] | null {
  if (depth > 6 || node == null) return null;
  if (Array.isArray(node)) {
    if (node.length > 0 && typeof node[0] === "object" && node[0] !== null) {
      return node as RawItem[];
    }
    return null;
  }
  if (typeof node === "object") {
    // page/list/content/rows/resultList 등 유력 키를 먼저 본다.
    const obj = node as Record<string, unknown>;
    const preferred = [
      "list",
      "content",
      "rows",
      "resultList",
      "items",
      "dataList",
      "pbancList",
    ];
    for (const k of preferred) {
      const arr = findFirstObjectArray(obj[k], depth + 1);
      if (arr) return arr;
    }
    for (const k of Object.keys(obj)) {
      if (preferred.includes(k)) continue;
      const arr = findFirstObjectArray(obj[k], depth + 1);
      if (arr) return arr;
    }
  }
  return null;
}

// 상세 링크: 항목에 URL이 있으면 사용, 없으면 sbiz24 상세 해시 경로를 구성.
function detailUrl(item: RawItem, sn: string | null): string | null {
  const u = pick(
    item,
    "detailUrl",
    "pbancUrl",
    "linkUrl",
    "dtlUrl",
    "url",
    "orgnztUrl",
    "hmpgUrl",
  );
  if (u) return u.startsWith("http") ? u : `https://www.sbiz24.kr${u.startsWith("/") ? "" : "/"}${u}`;
  if (sn) return `https://www.sbiz24.kr/#/combinePbancView?combinePbancSn=${sn}`;
  return "https://www.sbiz24.kr/#/combinePbancList?combine=combine";
}

function normalizeItem(
  item: RawItem,
  regions: RegionLite[],
): NormalizedProgram | null {
  const title = pick(
    item,
    "pbancNm",
    "combinePbancNm",
    "bizNm",
    "titleNm",
    "title",
    "sj",
    "bsnsNm",
  );
  if (!title) return null;

  const sn = pick(
    item,
    "combinePbancSn",
    "pbancSn",
    "sn",
    "bizSn",
    "id",
    "seq",
  );
  const externalId = `sbiz:${sn ?? title}`;

  const summary = stripHtml(
    pick(item, "pbancCn", "bsnsSumryCn", "cn", "summary", "pbancCtnt", "dtlCn"),
  );
  const institution = pick(
    item,
    "insttNm",
    "jrsdInsttNm",
    "excInsttNm",
    "deptNm",
    "orgNm",
    "ministryNm",
    "sprvInsttNm",
  );
  const field = pick(item, "rcrtTypeCdNm", "sportRealmNm", "bizFldNm", "sportRealmLclasCodeNm");
  const regionText =
    pick(item, "regionNm", "areaNm", "region") ??
    (Array.isArray(item.regionNmList) ? (item.regionNmList as string[]).join(" ") : "");

  // 접수 기간: 개별 begin/end 필드 우선, 없으면 기간 문자열 파싱.
  const begin = pick(
    item,
    "rceptBgngDe",
    "rceptBgngDt",
    "reqstBeginDe",
    "aplyBgngDe",
    "pbancRceptBgngDe",
  );
  const endRaw = pick(
    item,
    "rceptEndDe",
    "rceptEndDt",
    "reqstEndDe",
    "aplyEndDe",
    "pbancRceptEndDe",
  );
  let start = toISODate(begin);
  let end = toISODate(endRaw);
  let ongoing = false;
  if (!start && !end) {
    const p = parsePeriod(pick(item, "rceptPd", "reqstBeginEndDe", "period", "pbancPd"));
    start = p.start;
    end = p.end;
    ongoing = p.ongoing;
  }

  const category = classifyCategory(title, summary, field);
  const region = resolveRegion(`${regionText} ${title} ${institution ?? ""}`, regions);
  if (!region) return null; // 서울·경기와 무관한 타지역 전용 → 제외

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
    is_ongoing: ongoing || (!end && !start),
    source_url: detailUrl(item, sn),
  };
}

/** 소상공인24 통합공고 호출 후 정규화(서울·경기). 페이지네이션 포함. */
export async function fetchSbiz24Programs(opts: {
  regions: RegionLite[];
  perPage?: number;
  maxPages?: number;
}): Promise<NormalizedProgram[]> {
  const perPage = opts.perPage ?? 100;
  const maxPages = opts.maxPages ?? 5; // 최대 500건 커버
  const out: NormalizedProgram[] = [];

  for (let page = 0; page < maxPages; page++) {
    const startRow = page * perPage;
    const endRow = startRow + perPage;
    const json = await callSbiz(startRow, endRow);
    const items = extractItems(json);
    if (items.length === 0) break;
    for (const it of items) {
      const n = normalizeItem(it, opts.regions);
      if (n) out.push(n);
    }
    if (items.length < perPage) break;
  }
  return out;
}

/** 진단용: 배포 환경에서 원본 응답 구조/필드명을 그대로 확인. */
export async function fetchSbiz24Raw(): Promise<{
  itemCount: number;
  firstItemKeys: string[];
  firstItem: RawItem | null;
  envelopeKeys: string[];
}> {
  const json = await callSbiz(0, 5);
  const items = extractItems(json);
  const envelopeKeys =
    json && typeof json === "object" ? Object.keys(json as object) : [];
  return {
    itemCount: items.length,
    firstItemKeys: items[0] ? Object.keys(items[0]) : [],
    firstItem: items[0] ?? null,
    envelopeKeys,
  };
}
