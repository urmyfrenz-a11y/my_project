import type { LatLng } from "./types";

// 공공데이터포털 — 소상공인시장진흥공단 상가(상권)정보 API (서버 전용)
// 문서: https://www.data.go.kr/data/15012005/openapi.do
// 인증키는 "일반 인증키(Decoding)" 를 DATA_GO_KR_KEY 에 넣는다. (URLSearchParams가 1회 인코딩)

const SDSC_BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";

export function datagokrConfigured(): boolean {
  return !!process.env.DATA_GO_KR_KEY;
}

export interface StoreStats {
  total: number;
  byCategory: { name: string; count: number }[];
}

/** 반경 내 상가 통계 (점포 수 + 업종 상위 분포) */
export async function storesInRadius(
  center: LatLng,
  radius = 500
): Promise<StoreStats | null> {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return null;
  try {
    const url = new URL(`${SDSC_BASE}/storeListInRadius`);
    url.searchParams.set("serviceKey", key);
    url.searchParams.set("radius", String(radius)); // m, 최대 2000
    url.searchParams.set("cx", String(center.lng));
    url.searchParams.set("cy", String(center.lat));
    url.searchParams.set("type", "json");
    url.searchParams.set("numOfRows", "100");
    url.searchParams.set("pageNo", "1");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      body?: { totalCount?: number; items?: Array<Record<string, string>> };
      response?: {
        body?: { totalCount?: number; items?: Array<Record<string, string>> };
      };
    };
    const body = data.body ?? data.response?.body;
    if (!body) return null;
    const total = Number(body.totalCount ?? 0);
    const items = Array.isArray(body.items) ? body.items : [];
    const tally: Record<string, number> = {};
    for (const it of items) {
      const cat = it.indsLclsNm || it.ksicNm || "기타";
      tally[cat] = (tally[cat] ?? 0) + 1;
    }
    const byCategory = Object.entries(tally)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { total, byCategory };
  } catch {
    return null;
  }
}
