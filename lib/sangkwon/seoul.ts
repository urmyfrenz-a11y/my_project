// 서울 열린데이터광장 상권분석서비스(행정동 단위) 클라이언트 (서버 전용)
//  - VwsmAdstrdFlpopW : 생활인구(유동인구)
//  - VwsmAdstrdRepopW : 상주인구·가구·아파트세대
//  - VwsmAdstrdSelngW : 추정매출(업종별)
//  - VwsmAdstrdStorW  : 점포·개폐업(업종별)
// 위치 필터는 분기만 동작하므로 한 분기 데이터를 받아 행정동명/코드로 매칭.

const BASE = "http://openapi.seoul.go.kr:8088";

export function seoulConfigured(): boolean {
  return !!process.env.SEOUL_OPENAPI_KEY;
}

interface Block<T> {
  list_total_count?: number;
  RESULT?: { CODE: string; MESSAGE: string };
  row?: T[];
}

async function fetchSeoul<T>(
  svc: string,
  start: number,
  end: number,
  args = ""
): Promise<T[] | null> {
  const key = process.env.SEOUL_OPENAPI_KEY;
  if (!key) return null;
  const url = `${BASE}/${key}/json/${svc}/${start}/${end}${args}`;
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, Block<T>>;
    const block = data[svc];
    if (!block || block.RESULT?.CODE !== "INFO-000") return null;
    return block.row ?? [];
  } catch {
    return null;
  }
}

interface DongRow {
  ADSTRD_CD: string;
  ADSTRD_CD_NM: string;
  STDR_YYQU_CD: string;
}

function matchDong<T extends DongRow>(rows: T[], dongName?: string, admCode?: string): T | null {
  const code8 = admCode?.slice(0, 8);
  const cand = rows.filter(
    (r) =>
      (dongName && r.ADSTRD_CD_NM === dongName) ||
      (code8 && (r.ADSTRD_CD === code8 || admCode?.startsWith(r.ADSTRD_CD)))
  );
  if (!cand.length) return null;
  return cand.reduce((a, b) => (b.STDR_YYQU_CD > a.STDR_YYQU_CD ? b : a));
}

function dongKeyMatch(code: string, name: string, dongName?: string, admCode?: string): boolean {
  const code8 = admCode?.slice(0, 8);
  return Boolean(
    (dongName && name === dongName) ||
      (code8 && (code === code8 || admCode?.startsWith(code)))
  );
}

// ── 유동인구(생활인구) ──
interface FlpopRow extends DongRow {
  TOT_FLPOP_CO: number;
}
export async function getLivingPopulation(dongName?: string, admCode?: string) {
  const rows = await fetchSeoul<FlpopRow>("VwsmAdstrdFlpopW", 1, 1000);
  return rows ? matchDong(rows, dongName, admCode) : null;
}

// ── 상주인구(배후수요) ──
interface RepopRow extends DongRow {
  TOT_REPOP_CO: number;
  TOT_HSHLD_CO: number;
  APT_HSHLD_CO: number;
}
export async function getResidentPopulation(dongName?: string, admCode?: string) {
  const rows = await fetchSeoul<RepopRow>("VwsmAdstrdRepopW", 1, 1000);
  return rows ? matchDong(rows, dongName, admCode) : null;
}

// ── 추정매출(업종별) — 동 합계 + 업종별 상세 캐시 ──
interface SalesRow extends DongRow {
  SVC_INDUTY_CD_NM: string;
  THSMON_SELNG_AMT: number;
  THSMON_SELNG_CO: number;
  TMZON_00_06_SELNG_AMT: number;
  TMZON_06_11_SELNG_AMT: number;
  TMZON_11_14_SELNG_AMT: number;
  TMZON_14_17_SELNG_AMT: number;
  TMZON_17_21_SELNG_AMT: number;
  TMZON_21_24_SELNG_AMT: number;
  ML_SELNG_AMT: number;
  FML_SELNG_AMT: number;
  AGRDE_10_SELNG_AMT: number;
  AGRDE_20_SELNG_AMT: number;
  AGRDE_30_SELNG_AMT: number;
  AGRDE_40_SELNG_AMT: number;
  AGRDE_50_SELNG_AMT: number;
  AGRDE_60_ABOVE_SELNG_AMT: number;
}
interface IndutySales {
  amt: number;
  cnt: number;
  tmzon: number[]; // 6
  ml: number;
  fml: number;
  age: number[]; // 6
}
interface DongSalesEntry {
  name: string;
  total: number;
  top: { name: string; amt: number }[];
  byInduty: Map<string, IndutySales>;
}
export interface DongSales {
  quarter: string;
  total: number;
  name: string;
  top: { name: string; amt: number }[];
}
let salesCache: { quarter: string; map: Map<string, DongSalesEntry> } | null = null;

async function buildSalesCache(): Promise<string | null> {
  const head = await fetchSeoul<SalesRow>("VwsmAdstrdSelngW", 1, 1);
  const quarter = head?.[0]?.STDR_YYQU_CD;
  if (!quarter) return null;
  if (salesCache && salesCache.quarter === quarter) return quarter;

  const pages: Promise<SalesRow[] | null>[] = [];
  for (let s = 1; s <= 20001; s += 1000) {
    pages.push(fetchSeoul<SalesRow>("VwsmAdstrdSelngW", s, s + 999, `/${quarter}`));
  }
  const results = await Promise.all(pages);
  const map = new Map<string, DongSalesEntry>();
  for (const rows of results) {
    if (!rows) continue;
    for (const r of rows) {
      const amt = Number(r.THSMON_SELNG_AMT) || 0;
      const e =
        map.get(r.ADSTRD_CD) ??
        ({ name: r.ADSTRD_CD_NM, total: 0, top: [], byInduty: new Map() } as DongSalesEntry);
      e.total += amt;
      e.top.push({ name: r.SVC_INDUTY_CD_NM, amt });
      e.byInduty.set(r.SVC_INDUTY_CD_NM, {
        amt,
        cnt: Number(r.THSMON_SELNG_CO) || 0,
        tmzon: [
          Number(r.TMZON_00_06_SELNG_AMT) || 0,
          Number(r.TMZON_06_11_SELNG_AMT) || 0,
          Number(r.TMZON_11_14_SELNG_AMT) || 0,
          Number(r.TMZON_14_17_SELNG_AMT) || 0,
          Number(r.TMZON_17_21_SELNG_AMT) || 0,
          Number(r.TMZON_21_24_SELNG_AMT) || 0,
        ],
        ml: Number(r.ML_SELNG_AMT) || 0,
        fml: Number(r.FML_SELNG_AMT) || 0,
        age: [
          Number(r.AGRDE_10_SELNG_AMT) || 0,
          Number(r.AGRDE_20_SELNG_AMT) || 0,
          Number(r.AGRDE_30_SELNG_AMT) || 0,
          Number(r.AGRDE_40_SELNG_AMT) || 0,
          Number(r.AGRDE_50_SELNG_AMT) || 0,
          Number(r.AGRDE_60_ABOVE_SELNG_AMT) || 0,
        ],
      });
      map.set(r.ADSTRD_CD, e);
    }
  }
  for (const v of map.values()) {
    v.top.sort((a, b) => b.amt - a.amt);
    v.top = v.top.slice(0, 3);
  }
  salesCache = { quarter, map };
  return quarter;
}

export async function getDongSales(dongName?: string, admCode?: string): Promise<DongSales | null> {
  const quarter = await buildSalesCache();
  if (!quarter || !salesCache) return null;
  for (const [code, v] of salesCache.map) {
    if (dongKeyMatch(code, v.name, dongName, admCode)) {
      return { quarter, total: v.total, name: v.name, top: v.top };
    }
  }
  return null;
}

// ── 점포·개폐업(업종별) — 동 합계 + 업종별 상세 캐시 ──
interface StorRow extends DongRow {
  SVC_INDUTY_CD_NM: string;
  STOR_CO: number;
  FRC_STOR_CO: number;
  CLSBIZ_RT: number;
  OPBIZ_RT: number;
}
interface IndutyStor {
  stores: number;
  frc: number;
  clsW: number;
  opW: number;
}
interface DongStorEntry {
  name: string;
  stores: number;
  clsW: number;
  opW: number;
  byInduty: Map<string, IndutyStor>;
}
export interface DongDynamics {
  quarter: string;
  name: string;
  totalStores: number;
  avgClsbiz: number;
  avgOpbiz: number;
}
let storCache: { quarter: string; map: Map<string, DongStorEntry> } | null = null;

async function buildStorCache(): Promise<string | null> {
  const head = await fetchSeoul<StorRow>("VwsmAdstrdStorW", 1, 1);
  const quarter = head?.[0]?.STDR_YYQU_CD;
  if (!quarter) return null;
  if (storCache && storCache.quarter === quarter) return quarter;

  const pages: Promise<StorRow[] | null>[] = [];
  for (let s = 1; s <= 40001; s += 1000) {
    pages.push(fetchSeoul<StorRow>("VwsmAdstrdStorW", s, s + 999, `/${quarter}`));
  }
  const results = await Promise.all(pages);
  const map = new Map<string, DongStorEntry>();
  for (const rows of results) {
    if (!rows) continue;
    for (const r of rows) {
      const stores = Number(r.STOR_CO) || 0;
      const cls = Number(r.CLSBIZ_RT) || 0;
      const op = Number(r.OPBIZ_RT) || 0;
      const frc = Number(r.FRC_STOR_CO) || 0;
      const e =
        map.get(r.ADSTRD_CD) ??
        ({ name: r.ADSTRD_CD_NM, stores: 0, clsW: 0, opW: 0, byInduty: new Map() } as DongStorEntry);
      e.stores += stores;
      e.clsW += cls * stores;
      e.opW += op * stores;
      e.byInduty.set(r.SVC_INDUTY_CD_NM, { stores, frc, clsW: cls * stores, opW: op * stores });
      map.set(r.ADSTRD_CD, e);
    }
  }
  storCache = { quarter, map };
  return quarter;
}

export async function getDongStoreDynamics(
  dongName?: string,
  admCode?: string
): Promise<DongDynamics | null> {
  const quarter = await buildStorCache();
  if (!quarter || !storCache) return null;
  for (const [code, v] of storCache.map) {
    if (dongKeyMatch(code, v.name, dongName, admCode)) {
      return {
        quarter,
        name: v.name,
        totalStores: v.stores,
        avgClsbiz: v.stores ? v.clsW / v.stores : 0,
        avgOpbiz: v.stores ? v.opW / v.stores : 0,
      };
    }
  }
  return null;
}

// ── 업종별 상세(매출·시간대·성연령·개폐업) ──
const TIME_LABELS = ["새벽 0~6시", "오전 6~11시", "점심 11~14시", "오후 14~17시", "저녁 17~21시", "밤 21~24시"];
const AGE_LABELS = ["10대", "20대", "30대", "40대", "50대", "60대 이상"];

function argmaxLabel(arr: number[], labels: string[]): string | undefined {
  let mi = -1;
  let mv = -1;
  arr.forEach((v, i) => {
    if (v > mv) {
      mv = v;
      mi = i;
    }
  });
  return mi >= 0 && mv > 0 ? labels[mi] : undefined;
}

export interface IndustrySeoulDetailRaw {
  quarter: string;
  salesAmt: number;
  salesCnt: number;
  peakTime?: string;
  mainGender?: string;
  mainAge?: string;
  storeCount: number;
  openRate: number;
  closeRate: number;
  franchiseRate: number;
}

export async function getIndustryDetail(
  dongName: string | undefined,
  admCode: string | undefined,
  seoulSubs: string[]
): Promise<IndustrySeoulDetailRaw | null> {
  const [sq, tq] = await Promise.all([buildSalesCache(), buildStorCache()]);
  const quarter = sq || tq;
  if (!quarter) return null;

  // 동 엔트리 찾기
  let salesEntry: DongSalesEntry | undefined;
  if (salesCache) {
    for (const [code, v] of salesCache.map) {
      if (dongKeyMatch(code, v.name, dongName, admCode)) {
        salesEntry = v;
        break;
      }
    }
  }
  let storEntry: DongStorEntry | undefined;
  if (storCache) {
    for (const [code, v] of storCache.map) {
      if (dongKeyMatch(code, v.name, dongName, admCode)) {
        storEntry = v;
        break;
      }
    }
  }
  if (!salesEntry && !storEntry) return null;

  const match = (name: string) => seoulSubs.some((s) => name.includes(s));

  // 매출 집계
  let amt = 0;
  let cnt = 0;
  const tmzon = [0, 0, 0, 0, 0, 0];
  let ml = 0;
  let fml = 0;
  const age = [0, 0, 0, 0, 0, 0];
  if (salesEntry) {
    for (const [name, s] of salesEntry.byInduty) {
      if (!match(name)) continue;
      amt += s.amt;
      cnt += s.cnt;
      s.tmzon.forEach((v, i) => (tmzon[i] += v));
      ml += s.ml;
      fml += s.fml;
      s.age.forEach((v, i) => (age[i] += v));
    }
  }

  // 점포·개폐업 집계
  let stores = 0;
  let frc = 0;
  let clsW = 0;
  let opW = 0;
  if (storEntry) {
    for (const [name, s] of storEntry.byInduty) {
      if (!match(name)) continue;
      stores += s.stores;
      frc += s.frc;
      clsW += s.clsW;
      opW += s.opW;
    }
  }

  if (amt === 0 && stores === 0) return null;

  return {
    quarter,
    salesAmt: amt,
    salesCnt: cnt,
    peakTime: argmaxLabel(tmzon, TIME_LABELS),
    mainGender: ml === 0 && fml === 0 ? undefined : ml >= fml ? "남성" : "여성",
    mainAge: argmaxLabel(age, AGE_LABELS),
    storeCount: stores,
    openRate: stores ? opW / stores : 0,
    closeRate: stores ? clsW / stores : 0,
    franchiseRate: stores ? (frc / stores) * 100 : 0,
  };
}

// ── 소비(소득소비, 지출) ── VwsmAdstrdNcmCnsmpW
interface CnsmpRow extends DongRow {
  EXPNDTR_TOTAMT: number;
  FDSTFFS_EXPNDTR_TOTAMT: number;
  CLTHS_FTWR_EXPNDTR_TOTAMT: number;
  LVSPL_EXPNDTR_TOTAMT: number;
  MCP_EXPNDTR_TOTAMT: number;
  TRNSPORT_EXPNDTR_TOTAMT: number;
  EDC_EXPNDTR_TOTAMT: number;
  PLESR_EXPNDTR_TOTAMT: number;
  LSR_CLTUR_EXPNDTR_TOTAMT: number;
  ETC_EXPNDTR_TOTAMT: number;
  FD_EXPNDTR_TOTAMT: number;
}
const CNSMP_CATS: { key: keyof CnsmpRow; label: string }[] = [
  { key: "FD_EXPNDTR_TOTAMT", label: "음식(외식)" },
  { key: "FDSTFFS_EXPNDTR_TOTAMT", label: "식료품" },
  { key: "MCP_EXPNDTR_TOTAMT", label: "의료비" },
  { key: "EDC_EXPNDTR_TOTAMT", label: "교육" },
  { key: "LSR_CLTUR_EXPNDTR_TOTAMT", label: "여가·문화" },
  { key: "CLTHS_FTWR_EXPNDTR_TOTAMT", label: "의류·신발" },
  { key: "TRNSPORT_EXPNDTR_TOTAMT", label: "교통" },
  { key: "LVSPL_EXPNDTR_TOTAMT", label: "생활용품" },
  { key: "PLESR_EXPNDTR_TOTAMT", label: "유흥" },
];
export interface DongConsumption {
  quarter: string;
  name: string;
  total: number;
  topCategory?: string;
}
// 동→최신분기 row (전 분기 정렬이 섞여 있어 전체를 받아 동별 최신 선택)
let cnsmpCache: Map<string, CnsmpRow> | null = null;

async function buildCnsmpCache(): Promise<boolean> {
  if (cnsmpCache) return true;
  const pages: Promise<CnsmpRow[] | null>[] = [];
  for (let s = 1; s <= 9001; s += 1000) {
    pages.push(fetchSeoul<CnsmpRow>("VwsmAdstrdNcmCnsmpW", s, s + 999));
  }
  const results = await Promise.all(pages);
  const map = new Map<string, CnsmpRow>();
  for (const rows of results) {
    if (!rows) continue;
    for (const r of rows) {
      const prev = map.get(r.ADSTRD_CD);
      if (!prev || r.STDR_YYQU_CD > prev.STDR_YYQU_CD) map.set(r.ADSTRD_CD, r);
    }
  }
  if (map.size === 0) return false;
  cnsmpCache = map;
  return true;
}

export async function getConsumption(
  dongName?: string,
  admCode?: string
): Promise<DongConsumption | null> {
  const ok = await buildCnsmpCache();
  if (!ok || !cnsmpCache) return null;
  for (const [code, r] of cnsmpCache) {
    if (dongKeyMatch(code, r.ADSTRD_CD_NM, dongName, admCode)) {
      let topCategory: string | undefined;
      let topVal = -1;
      for (const c of CNSMP_CATS) {
        const v = Number(r[c.key]) || 0;
        if (v > topVal) {
          topVal = v;
          topCategory = c.label;
        }
      }
      return {
        quarter: r.STDR_YYQU_CD,
        name: r.ADSTRD_CD_NM,
        total: Number(r.EXPNDTR_TOTAMT) || 0,
        topCategory,
      };
    }
  }
  return null;
}
