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

/** 좌표 → 행정구역 명칭 (예: "중구 명동") */
export async function reverseRegion(center: LatLng): Promise<string | null> {
  const headers = authHeader();
  if (!headers) return null;
  try {
    const url = new URL(`${KAKAO_BASE}/v2/local/geo/coord2regioncode.json`);
    url.searchParams.set("x", String(center.lng));
    url.searchParams.set("y", String(center.lat));
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const doc =
      data.documents?.find((d: { region_type: string }) => d.region_type === "H") ??
      data.documents?.[0];
    if (!doc) return null;
    return [doc.region_2depth_name, doc.region_3depth_name].filter(Boolean).join(" ");
  } catch {
    return null;
  }
}

/** 반경 내 집객시설 POI 개수 (9번 팩터 보완). category_group_code 예: FD6 음식점, CE7 카페 등 */
export async function countNearbyPois(
  center: LatLng,
  radius = 400
): Promise<number | null> {
  const headers = authHeader();
  if (!headers) return null;
  try {
    const url = new URL(`${KAKAO_BASE}/v2/local/search/category.json`);
    url.searchParams.set("category_group_code", "FD6");
    url.searchParams.set("x", String(center.lng));
    url.searchParams.set("y", String(center.lat));
    url.searchParams.set("radius", String(radius));
    url.searchParams.set("size", "15");
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.meta?.total_count ?? null;
  } catch {
    return null;
  }
}
