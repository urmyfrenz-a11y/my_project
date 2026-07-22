// 한국부동산원 R-ONE 부동산통계 OpenAPI 클라이언트 (서버 전용)
//  - 상업용부동산 임대동향조사(STAT_ID S237220284)의 "지역별 임대료 / 공실률(중대형 상가)"
//  - 통계표 ID(STATBL_ID)를 하드코딩하지 않고 R-ONE 통계표 목록에서 이름으로 런타임 탐색
//    (개편으로 STATBL_ID가 바뀌어도 자동 추종)
//
// 엔드포인트:
//  - 목록 : https://www.reb.or.kr/r-one/openapi/SttsApiTbl.do
//  - 데이터: https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do
//  파라미터: KEY, Type=json, STATBL_ID, DTACYCLE_CD, (WRTTIME_IDTFR_ID), pIndex, pSize

const BASE = "https://www.reb.or.kr/r-one/openapi";

export function roneConfigured(): boolean {
  return !!process.env.R_ONE_KEY;
}

// ── 응답 파싱 헬퍼 ──
interface Head {
  list_total_count?: number;
  RESULT?: { CODE?: string; MESSAGE?: string };
}
/** R-ONE 응답 { <svc>: [ {head:[...]}, {row:[...]} ] } 에서 row 추출 */
function rowsOf<T>(json: unknown, svc: string): T[] {
  const container = (json as Record<string, unknown>)?.[svc];
  if (!Array.isArray(container)) return [];
  for (const part of container) {
    const row = (part as { row?: T[] })?.row;
    if (Array.isArray(row)) return row;
  }
  return [];
}
function headOf(json: unknown, svc: string): Head | null {
  const container = (json as Record<string, unknown>)?.[svc];
  if (!Array.isArray(container)) return null;
  for (const part of container) {
    const head = (part as { head?: unknown[] })?.head;
    if (Array.isArray(head)) {
      const merged: Head = {};
      for (const h of head) Object.assign(merged, h);
      return merged;
    }
  }
  return null;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ── 통계표 목록 ──
interface TblRow {
  STATBL_ID: string;
  STATBL_NM: string;
  DTACYCLE_CD?: string;
}

let tableListCache: TblRow[] | null = null;

async function loadTableList(): Promise<TblRow[]> {
  if (tableListCache) return tableListCache;
  const key = process.env.R_ONE_KEY;
  if (!key) return [];
  const all: TblRow[] = [];
  for (let pIndex = 1; pIndex <= 12; pIndex++) {
    const url = `${BASE}/SttsApiTbl.do?KEY=${encodeURIComponent(key)}&Type=json&pIndex=${pIndex}&pSize=1000`;
    const json = await fetchJson(url);
    const rows = rowsOf<TblRow>(json, "SttsApiTbl");
    if (rows.length === 0) break;
    all.push(...rows);
    const total = headOf(json, "SttsApiTbl")?.list_total_count ?? 0;
    if (all.length >= total || rows.length < 1000) break;
  }
  if (all.length) tableListCache = all;
  return all;
}

/** 이름으로 통계표 1개 선택 (must 모두 포함, exclude 하나라도 포함 시 제외, 최신 시리즈 우선) */
function pickTable(list: TblRow[], must: string[], exclude: string[]): TblRow | null {
  const cand = list.filter(
    (t) =>
      typeof t.STATBL_NM === "string" &&
      must.every((m) => t.STATBL_NM.includes(m)) &&
      !exclude.some((x) => t.STATBL_NM.includes(x))
  );
  if (!cand.length) return null;
  // 최신 개편(2024년3분기~) 시리즈 우선, 그 외 이름 역순
  const score = (nm: string) =>
    (nm.includes("2024년3분기") || nm.includes("2024년 3분기") ? 2 : 0) +
    (nm.includes("2022") ? 1 : 0);
  return cand.reduce((a, b) => (score(b.STATBL_NM) > score(a.STATBL_NM) ? b : a));
}

// ── 통계 데이터 ──
interface DataRow {
  WRTTIME_IDTFR_ID?: string;
  WRTTIME_DESC?: string;
  CLS_NM?: string;
  ITM_NM?: string;
  DTA_VAL?: string | number;
  UI_NM?: string;
}

async function loadTableData(statblId: string, dtacycle?: string): Promise<DataRow[]> {
  const key = process.env.R_ONE_KEY;
  if (!key) return [];
  let url = `${BASE}/SttsApiTblData.do?KEY=${encodeURIComponent(key)}&Type=json&STATBL_ID=${encodeURIComponent(
    statblId
  )}&pIndex=1&pSize=2000`;
  if (dtacycle) url += `&DTACYCLE_CD=${encodeURIComponent(dtacycle)}`;
  const json = await fetchJson(url);
  return rowsOf<DataRow>(json, "SttsApiTblData");
}

/** 서울(시도 집계) 최신 분기 값 추출 */
function seoulLatest(rows: DataRow[]): { value: number; quarter: string; unit?: string; region: string } | null {
  const seoul = rows.filter((r) => typeof r.CLS_NM === "string" && r.CLS_NM.includes("서울"));
  if (!seoul.length) return null;
  // 시도 집계 우선 = CLS_NM 이 가장 짧은(하위 상권명이 붙지 않은) 행
  const minLen = Math.min(...seoul.map((r) => (r.CLS_NM as string).length));
  const agg = seoul.filter((r) => (r.CLS_NM as string).length === minLen);
  const pool = agg.length ? agg : seoul;
  // 최신 분기
  const latest = pool.reduce((a, b) =>
    String(b.WRTTIME_IDTFR_ID ?? "") > String(a.WRTTIME_IDTFR_ID ?? "") ? b : a
  );
  const v = Number(latest.DTA_VAL);
  if (!isFinite(v)) return null;
  return {
    value: v,
    quarter: latest.WRTTIME_DESC || String(latest.WRTTIME_IDTFR_ID ?? ""),
    unit: latest.UI_NM,
    region: latest.CLS_NM as string,
  };
}

export interface RentVacancy {
  /** 서울 중대형상가 임대료 (원/㎡) */
  rent: number | null;
  rentUnit?: string;
  /** 서울 중대형상가 공실률 (%) */
  vacancy: number | null;
  quarter: string;
  region: string;
}

let rentCache: RentVacancy | null = null;

/** 서울 중대형상가 임대료·공실률 (최신 분기, R-ONE 실데이터) */
export async function getRentVacancy(): Promise<RentVacancy | null> {
  if (!roneConfigured()) return null;
  if (rentCache) return rentCache;
  const list = await loadTableList();
  if (!list.length) return null;

  const rentTbl = pickTable(list, ["임대료", "중대형"], ["층별", "지수"]);
  const vacTbl = pickTable(list, ["공실률", "중대형"], []);
  if (!rentTbl && !vacTbl) return null;

  const [rentRows, vacRows] = await Promise.all([
    rentTbl ? loadTableData(rentTbl.STATBL_ID, rentTbl.DTACYCLE_CD) : Promise.resolve([]),
    vacTbl ? loadTableData(vacTbl.STATBL_ID, vacTbl.DTACYCLE_CD) : Promise.resolve([]),
  ]);

  const rent = seoulLatest(rentRows);
  const vac = seoulLatest(vacRows);
  if (!rent && !vac) return null;

  const result: RentVacancy = {
    rent: rent ? rent.value : null,
    rentUnit: rent?.unit,
    vacancy: vac ? vac.value : null,
    quarter: (rent?.quarter || vac?.quarter) ?? "",
    region: (rent?.region || vac?.region) ?? "서울",
  };
  rentCache = result;
  return result;
}

// ── 진단용: 탐색된 통계표와 원자료 샘플을 함께 반환 ──
export async function debugRent() {
  const list = await loadTableList();
  const rentTbl = pickTable(list, ["임대료", "중대형"], ["층별", "지수"]);
  const vacTbl = pickTable(list, ["공실률", "중대형"], []);
  const [rentRows, vacRows] = await Promise.all([
    rentTbl ? loadTableData(rentTbl.STATBL_ID, rentTbl.DTACYCLE_CD) : Promise.resolve([]),
    vacTbl ? loadTableData(vacTbl.STATBL_ID, vacTbl.DTACYCLE_CD) : Promise.resolve([]),
  ]);
  const rentCandidates = list
    .filter((t) => typeof t.STATBL_NM === "string" && t.STATBL_NM.includes("임대") && t.STATBL_NM.includes("상가"))
    .map((t) => ({ id: t.STATBL_ID, nm: t.STATBL_NM, cyc: t.DTACYCLE_CD }))
    .slice(0, 40);
  return {
    tableCount: list.length,
    rentTbl,
    vacTbl,
    rentSampleRows: rentRows.slice(0, 4),
    vacSampleRows: vacRows.slice(0, 4),
    parsedRent: seoulLatest(rentRows),
    parsedVac: seoulLatest(vacRows),
    rentCandidates,
  };
}
