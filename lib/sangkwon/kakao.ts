import type { GeocodeResult, LatLng } from "./types";

// 카카오 로컬 API (서버 전용). KAKAO_REST_KEY 필요.
// 문서: https://developers.kakao.com/docs/latest/ko/local/dev-guide

const KAKAO_BASE = "https://dapi.kakao.com";

function authHeader(): HeadersInit | null {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) return null;
  return { Authorization: `KakaoAK ${key}` };
}

export function kakaoConfigured(): boolean {
  return !!process.env.KAKAO_REST_KEY;
}

/** 주소 문자열 → 좌표. 주소검색 실패 시 키워드 장소검색으로 폴백. */
export async function geocode(query: string): Promise<GeocodeResult | null> {
  const headers = authHeader();
  if (!headers) return null;

  // 1) 주소 검색
  try {
    const url = new URL(`${KAKAO_BASE}/v2/local/search/address.json`);
    url.searchParams.set("query", query);
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const doc = data.documents?.[0];
      if (doc) {
        return {
          address: doc.address_name,
          roadAddress: doc.road_address?.address_name,
          center: { lat: parseFloat(doc.y), lng: parseFloat(doc.x) },
        };
      }
    }
  } catch {
    /* fallthrough to keyword */
  }

  // 2) 키워드(장소명) 검색 폴백
  try {
    const url = new URL(`${KAKAO_BASE}/v2/local/search/keyword.json`);
    url.searchParams.set("query", query);
    url.searchParams.set("size", "1");
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const doc = data.documents?.[0];
      if (doc) {
        return {
          address: doc.address_name,
          roadAddress: doc.road_address_name,
          placeName: doc.place_name,
          center: { lat: parseFloat(doc.y), lng: parseFloat(doc.x) },
        };
      }
    }
  } catch {
    /* noop */
  }
  return null;
}

/** 좌표 → 행정구역 명칭 (예: "중구 명동") + 시/도 + 행정동 코드 */
export async function reverseRegion(
  center: LatLng
): Promise<{ name: string; sido?: string; admCode?: string } | null> {
  const headers = authHeader();
  if (!headers) return null;
  try {
    const url = new URL(`${KAKAO_BASE}/v2/local/geo/coord2regioncode.json`);
    url.searchParams.set("x", String(center.lng));
    url.searchParams.set("y", String(center.lat));
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      documents?: Array<{
        region_type: string;
        region_1depth_name?: string;
        region_2depth_name?: string;
        region_3depth_name?: string;
        code?: string;
      }>;
    };
    const doc =
      data.documents?.find((d) => d.region_type === "H") ?? data.documents?.[0];
    if (!doc) return null;
    const name = [doc.region_2depth_name, doc.region_3depth_name]
      .filter(Boolean)
      .join(" ");
    return { name, sido: doc.region_1depth_name, admCode: doc.code };
  } catch {
    return null;
  }
}

/** 키워드(업종명) 반경 검색 → 해당 업종 점포 수 */
export async function countByKeyword(
  center: LatLng,
  keyword: string,
  radius = 500
): Promise<number | null> {
  const headers = authHeader();
  if (!headers) return null;
  try {
    const url = new URL(`${KAKAO_BASE}/v2/local/search/keyword.json`);
    url.searchParams.set("query", keyword);
    url.searchParams.set("x", String(center.lng));
    url.searchParams.set("y", String(center.lat));
    url.searchParams.set("radius", String(radius));
    url.searchParams.set("size", "1");
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { meta?: { total_count?: number } };
    return data.meta?.total_count ?? null;
  } catch {
    return null;
  }
}

/** 특정 카테고리의 반경 내 총 개수 (Kakao category_group_code 기준) */
async function categoryTotal(
  center: LatLng,
  code: string,
  radius: number
): Promise<number | null> {
  const headers = authHeader();
  if (!headers) return null;
  try {
    const url = new URL(`${KAKAO_BASE}/v2/local/search/category.json`);
    url.searchParams.set("category_group_code", code);
    url.searchParams.set("x", String(center.lng));
    url.searchParams.set("y", String(center.lat));
    url.searchParams.set("radius", String(radius));
    url.searchParams.set("size", "1");
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { meta?: { total_count?: number } };
    return data.meta?.total_count ?? null;
  } catch {
    return null;
  }
}

/** 집객시설(9번): 반경 내 문화시설(CT1)+관광명소(AT4)+대형마트(MT1) 합계 */
export async function countAttractionPois(
  center: LatLng,
  radius = 500
): Promise<number | null> {
  const [culture, tour, mart] = await Promise.all([
    categoryTotal(center, "CT1", radius),
    categoryTotal(center, "AT4", radius),
    categoryTotal(center, "MT1", radius),
  ]);
  if (culture == null && tour == null && mart == null) return null;
  return (culture ?? 0) + (tour ?? 0) + (mart ?? 0);
}

/** 지하철 접근성(8번): 가장 가까운 지하철역 거리 + 반경 내 개수 */
export async function nearestSubway(
  center: LatLng,
  radius = 800
): Promise<{ count: number; nearestName?: string; nearestDist?: number } | null> {
  const headers = authHeader();
  if (!headers) return null;
  try {
    const url = new URL(`${KAKAO_BASE}/v2/local/search/category.json`);
    url.searchParams.set("category_group_code", "SW8");
    url.searchParams.set("x", String(center.lng));
    url.searchParams.set("y", String(center.lat));
    url.searchParams.set("radius", String(radius));
    url.searchParams.set("sort", "distance");
    url.searchParams.set("size", "5");
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      meta?: { total_count?: number };
      documents?: Array<{ place_name?: string; distance?: string }>;
    };
    const count = data.meta?.total_count ?? 0;
    const first = data.documents?.[0];
    return {
      count,
      nearestName: first?.place_name,
      nearestDist: first?.distance ? Number(first.distance) : undefined,
    };
  } catch {
    return null;
  }
}
