// 서울 열린데이터광장 상권분석서비스(행정동 단위) 클라이언트 (서버 전용)
// 확인된 서비스명(Vwsm{Adstrd}{지표}W) — 행정동당 1행(매출은 업종별 다행).
//  - VwsmAdstrdFlpopW : 생활인구(유동인구)  TOT_FLPOP_CO
//  - VwsmAdstrdRepopW : 상주인구           TOT_REPOP_CO, TOT_HSHLD_CO, APT_HSHLD_CO
//  - VwsmAdstrdSelngW : 추정매출(업종별)   THSMON_SELNG_AMT
// 위치 필터는 분기(STDR_YYQU_CD)만 동작하고 행정동 코드로는 안 되므로,
// 한 분기 데이터를 받아 행정동명/코드로 매칭한다.

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
  args = "",
  revalidate = 86400
): Promise<T[] | null> {
  const key = process.env.SEOUL_OPENAPI_KEY;
  if (!key) return null;
  const url = `${BASE}/${key}/json/${svc}/${start}/${end}${args}`;
  try {
    const res = await fetch(url, { next: { revalidate } });
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

/** 행정동명(우선) 또는 코드로 매칭, 여러 분기 중 최신 선택 */
function matchDong<T extends DongRow>(
  rows: T[],
  dongName?: string,
  admCode?: string
): T | null {
  const code8 = admCode?.slice(0, 8);
  const cand = rows.filter(
    (r) =>
      (dongName && r.ADSTRD_CD_NM === dongName) ||
      (code8 && (r.ADSTRD_CD === code8 || admCode?.startsWith(r.ADSTRD_CD)))
  );
  if (!cand.length) return null;
  return cand.reduce((a, b) => (b.STDR_YYQU_CD > a.STDR_YYQU_CD ? b : a));
}

// ── 유동인구(생활인구) ─────────────────────────────
interface FlpopRow extends DongRow {
  TOT_FLPOP_CO: number;
}
export async function getLivingPopulation(dongName?: string, admCode?: string) {
  const rows = await fetchSeoul<FlpopRow>("VwsmAdstrdFlpopW", 1, 1000);
  return rows ? matchDong(rows, dongName, admCode) : null;
}

// ── 상주인구(배후수요) ─────────────────────────────
interface RepopRow extends DongRow {
  TOT_REPOP_CO: number;
  TOT_HSHLD_CO: number;
  APT_HSHLD_CO: number;
}
export async function getResidentPopulation(dongName?: string, admCode?: string) {
  const rows = await fetchSeoul<RepopRow>("VwsmAdstrdRepopW", 1, 1000);
  return rows ? matchDong(rows, dongName, admCode) : null;
}

// ── 추정매출(업종별 → 동 합계) ─────────────────────
interface SalesRow extends DongRow {
  SVC_INDUTY_CD_NM: string;
  THSMON_SELNG_AMT: number;
}
interface DongSales {
  quarter: string;
  total: number;
  name: string;
  top: { name: string; amt: number }[];
}
// 분기별 집계 결과를 워엄 람다 메모리에 캐시 (Next fetch 캐시가 원본을 캐시)
let salesCache: { quarter: string; map: Map<string, DongSales> } | null = null;

export async function getDongSales(
  dongName?: string,
  admCode?: string
): Promise<DongSales | null> {
  // 최신 분기 확인
  const head = await fetchSeoul<SalesRow>("VwsmAdstrdSelngW", 1, 1);
  const quarter = head?.[0]?.STDR_YYQU_CD;
  if (!quarter) return null;

  if (!salesCache || salesCache.quarter !== quarter) {
    // 해당 분기 전체(약 17k행)를 1000행씩 병렬 수집
    const pages: Promise<SalesRow[] | null>[] = [];
    for (let s = 1; s <= 20001; s += 1000) {
      pages.push(fetchSeoul<SalesRow>("VwsmAdstrdSelngW", s, s + 999, `/${quarter}`));
    }
    const results = await Promise.all(pages);
    const map = new Map<string, DongSales>();
    for (const rows of results) {
      if (!rows) continue;
      for (const r of rows) {
        const amt = Number(r.THSMON_SELNG_AMT) || 0;
        const cur =
          map.get(r.ADSTRD_CD) ??
          ({ quarter, total: 0, name: r.ADSTRD_CD_NM, top: [] } as DongSales);
        cur.total += amt;
        cur.top.push({ name: r.SVC_INDUTY_CD_NM, amt });
        map.set(r.ADSTRD_CD, cur);
      }
    }
    for (const v of map.values()) {
      v.top.sort((a, b) => b.amt - a.amt);
      v.top = v.top.slice(0, 3);
    }
    salesCache = { quarter, map };
  }

  const code8 = admCode?.slice(0, 8);
  for (const [code, v] of salesCache.map) {
    if (
      (dongName && v.name === dongName) ||
      (code8 && (code === code8 || admCode?.startsWith(code)))
    ) {
      return v;
    }
  }
  return null;
}
