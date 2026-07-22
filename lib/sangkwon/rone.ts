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

/** 진단용: 원본 응답을 그대로 반환 */
export async function rawTblData(statblId: string, dtacycle?: string, wrttime?: string) {
  const key = process.env.R_ONE_KEY;
  if (!key) return { error: "no key" };
  let url = `${BASE}/SttsApiTblData.do?KEY=${encodeURIComponent(key)}&Type=json&STATBL_ID=${encodeURIComponent(
    statblId
  )}&pIndex=1&pSize=100`;
  if (dtacycle) url += `&DTACYCLE_CD=${encodeURIComponent(dtacycle)}`;
  if (wrttime) url += `&WRTTIME_IDTFR_ID=${encodeURIComponent(wrttime)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const text = await res.text();
    let rootKeys: string[] = [];
    try {
      rootKeys = Object.keys(JSON.parse(text));
    } catch {
      /* not json */
    }
    return {
      status: res.status,
      urlShown: url.replace(encodeURIComponent(key), "***"),
      rootKeys,
      textHead: text.slice(0, 1500),
    };
  } catch (e) {
    return { error: String(e) };
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    // no-store: R-ONE 응답을 Vercel Data Cache에 남기지 않음(과거 빈 응답 캐싱 방지).
    // 반복 호출은 모듈 레벨 캐시(tableListCache/rentCache)로 억제.
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
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
// 실제 응답 예: CLS_NM="광화문", CLS_FULLNM="서울>도심>광화문",
//   ITM_NM="임대료", DTA_VAL=91.36, UI_NM="천원/㎡", WRTTIME_IDTFR_ID="202503"
interface DataRow {
  WRTTIME_IDTFR_ID?: string;
  WRTTIME_DESC?: string;
  CLS_NM?: string;
  CLS_FULLNM?: string;
  ITM_NM?: string;
  DTA_VAL?: string | number;
  UI_NM?: string;
}

/** 통계표 전체 시계열(전 지역·전 분기) 조회 — 시점 미지정 시 모든 분기 반환 */
async function loadTableData(statblId: string, dtacycle?: string): Promise<DataRow[]> {
  const key = process.env.R_ONE_KEY;
  if (!key) return [];
  let url = `${BASE}/SttsApiTblData.do?KEY=${encodeURIComponent(key)}&Type=json&STATBL_ID=${encodeURIComponent(
    statblId
  )}&pIndex=1&pSize=4000`;
  if (dtacycle) url += `&DTACYCLE_CD=${encodeURIComponent(dtacycle)}`;
  const json = await fetchJson(url);
  return rowsOf<DataRow>(json, "SttsApiTblData");
}

/** 서울 최신 분기 값 추출 (지역은 CLS_FULLNM 기준: "서울" 또는 "서울>...") */
function seoulLatest(
  rows: DataRow[]
): { value: number; quarter: string; unit?: string; region: string } | null {
  const region = (r: DataRow) => (typeof r.CLS_FULLNM === "string" ? r.CLS_FULLNM : r.CLS_NM ?? "");
  const seoul = rows.filter((r) => region(r).startsWith("서울"));
  if (!seoul.length) return null;

  // 최신 분기 코드
  const latestQ = seoul.reduce(
    (m, r) => (String(r.WRTTIME_IDTFR_ID ?? "") > m ? String(r.WRTTIME_IDTFR_ID ?? "") : m),
    ""
  );
  const atLatest = seoul.filter((r) => String(r.WRTTIME_IDTFR_ID ?? "") === latestQ);
  if (!atLatest.length) return null;

  // 서울 시도 집계 행("서울") 우선, 없으면 서울 소재 상권 평균
  const agg = atLatest.find((r) => region(r) === "서울" || r.CLS_NM === "서울" || r.CLS_NM === "서울특별시");
  let value: number;
  let label: string;
  if (agg) {
    value = Number(agg.DTA_VAL);
    label = "서울";
  } else {
    const vals = atLatest.map((r) => Number(r.DTA_VAL)).filter((v) => isFinite(v));
    if (!vals.length) return null;
    value = vals.reduce((a, b) => a + b, 0) / vals.length;
    label = "서울 주요상권 평균";
  }
  if (!isFinite(value)) return null;
  return {
    value,
    quarter: atLatest[0].WRTTIME_DESC || latestQ,
    unit: atLatest[0].UI_NM,
    region: label,
  };
}

export interface RentVacancy {
  /** 서울 중대형상가 임대료 (R-ONE 원자료 값, 보통 천원/㎡) */
  rent: number | null;
  rentUnit?: string;
  /** 임대료를 원/㎡로 환산한 값 (점수 계산용) */
  rentWonPerM2: number | null;
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

  // 임대료 단위가 "천원/㎡"이면 원/㎡로 환산
  const toWon = (v: number, unit?: string) => (unit && unit.includes("천원") ? v * 1000 : v);

  const result: RentVacancy = {
    rent: rent ? Math.round(rent.value * 10) / 10 : null,
    rentUnit: rent?.unit,
    rentWonPerM2: rent ? Math.round(toWon(rent.value, rent.unit)) : null,
    vacancy: vac ? Math.round(vac.value * 10) / 10 : null,
    quarter: (rent?.quarter || vac?.quarter) ?? "",
    region: (rent?.region || vac?.region) ?? "서울",
  };
  rentCache = result;
  return result;
}

// ── 진단용: 탐색된 통계표와 파싱 결과 반환 ──
export async function debugRent() {
  const r = await getRentVacancy();
  const list = await loadTableList();
  const rentTbl = pickTable(list, ["임대료", "중대형"], ["층별", "지수"]);
  const vacTbl = pickTable(list, ["공실률", "중대형"], []);
  return {
    tableCount: list.length,
    rentTbl: rentTbl ? { id: rentTbl.STATBL_ID, nm: rentTbl.STATBL_NM } : null,
    vacTbl: vacTbl ? { id: vacTbl.STATBL_ID, nm: vacTbl.STATBL_NM } : null,
    parsed: r,
  };
}
