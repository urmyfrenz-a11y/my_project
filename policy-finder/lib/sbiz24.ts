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

// 검색 조건(search). 실제 브라우저가 200 받는 요청을 그대로 미러링한다.
// 누락 필드가 있으면 서버가 500 → 전체 필드를 채워야 한다. 지역은 코드가 실제
// 필터: 11=서울, 31=경기. aplySeYn:"Y" = 모집중만. 지원대상/업종은 비워 전체.
type SearchObj = Record<string, unknown>;

function fullSearch(
  rcrtTypeCdNmList: string[],
  rcrtTypeCdNmListDisplay: string,
): SearchObj {
  return {
    rcrtTypeCdNmList,
    rcrtTypeCdNmListDisplay,
    regionNmList: ["경기", "서울"],
    regionNmListDisplay: "경기, 서울",
    regionCdList: ["31", "11"],
    departNmList: [],
    departNmListDisplay: null,
    tpbizCdList: [],
    tpbizCdListDisplay: "",
    bhis: { from: null, to: null },
    wrkr: { from: null, to: null },
    sls: { from: null, to: null },
    aplySeYn: "Y",
    sbrPbancYn: "N",
    itrstPbancYn: "N",
    pbancNm: "",
    ptPbancSortBy: null,
    bizType: null,
    searchBox: null,
  };
}

// 전체 대상 먼저(빈 배열=전 지원대상), 혹시 실패하면 소상공인 한정으로 폴백.
export const SEARCH_VARIANTS: { name: string; search: SearchObj }[] = [
  { name: "all-types", search: fullSearch([], "") },
  { name: "sosang", search: fullSearch(["소상공인"], "소상공인") },
];

function buildBody(search: SearchObj, startRow: number, endRow: number) {
  return { startRow, endRow, paging: true, sortModel: [], search };
}

interface RawResult {
  status: number;
  ok: boolean;
  json: unknown;
  text: string;
}

async function rawCall(body: unknown): Promise<RawResult> {
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
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 비JSON */
  }
  return { status: res.status, ok: res.ok, json, text };
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

/** 소상공인24 통합공고 호출 후 정규화(서울·경기). 페이지네이션 포함.
 *  작동하는 search 형태를 자동 선택(첫 페이지에서 200+데이터가 나오는 변형). */
export async function fetchSbiz24Programs(opts: {
  regions: RegionLite[];
  perPage?: number;
  maxPages?: number;
}): Promise<NormalizedProgram[]> {
  const perPage = opts.perPage ?? 100;
  const maxPages = opts.maxPages ?? 5; // 최대 500건 커버
  const out: NormalizedProgram[] = [];

  // 1) 작동하는 검색 변형 찾기
  let chosen: SearchObj | null = null;
  const errors: string[] = [];
  for (const v of SEARCH_VARIANTS) {
    const r = await rawCall(buildBody(v.search, 0, perPage));
    if (r.ok && extractItems(r.json).length > 0) {
      chosen = v.search;
      for (const it of extractItems(r.json)) {
        const n = normalizeItem(it, opts.regions);
        if (n) out.push(n);
      }
      break;
    }
    errors.push(`${v.name}:HTTP${r.status}`);
  }
  if (!chosen) {
    throw new Error(`소상공인24 유효 응답 없음 (${errors.join(", ")})`);
  }

  // 2) 나머지 페이지
  for (let page = 1; page < maxPages; page++) {
    const startRow = page * perPage;
    const r = await rawCall(buildBody(chosen, startRow, startRow + perPage));
    if (!r.ok) break;
    const items = extractItems(r.json);
    if (items.length === 0) break;
    for (const it of items) {
      const n = normalizeItem(it, opts.regions);
      if (n) out.push(n);
    }
    if (items.length < perPage) break;
  }
  return out;
}

/** 진단용: 여러 본문 변형을 시도해 어떤 게 200+데이터를 주는지, 필드명까지 보고. */
export async function fetchSbiz24Raw(): Promise<{ variants: unknown[] }> {
  const variants: unknown[] = [];
  for (const v of SEARCH_VARIANTS) {
    try {
      const r = await rawCall(buildBody(v.search, 0, 10));
      const items = r.ok ? extractItems(r.json) : [];
      variants.push({
        variant: v.name,
        status: r.status,
        itemCount: items.length,
        envelopeKeys:
          r.json && typeof r.json === "object" ? Object.keys(r.json as object) : [],
        firstItemKeys: items[0] ? Object.keys(items[0]) : [],
        firstItem: items[0] ?? null,
        errorText: r.ok ? null : r.text.slice(0, 200),
      });
    } catch (e) {
      variants.push({
        variant: v.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { variants };
}
