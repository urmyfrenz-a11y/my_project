// Apify "Naver Map Scraper"(huggable_quote/naver-map-scraper)로 네이버 플레이스
// 상세정보를 가져온다. 네이버 리뷰 수집에 쓰는 액터와 같은 제작자이고, URL 입력
// (map.naver.com / m.place / naver.me 단축링크)을 그대로 받는다. 액터가 네이버
// 접근(프록시·핑거프린팅)을 처리하므로 Vercel 데이터센터 IP 문제를 우회한다.
//
// 무료 $5/월 크레딧으로 약 1,600곳. 리뷰 본문은 필요 없어(개수만 사용) 끄고 부른다.

const ACTOR = "huggable_quote~naver-map-scraper";

function apifyToken(): string {
  // 붙여넣기 과정에서 흔한 앞뒤 공백·줄바꿈·따옴표를 제거해 401 을 예방한다.
  return (process.env.APIFY_TOKEN ?? "").trim().replace(/^["']|["']$/g, "");
}

export function hasApify(): boolean {
  return !!apifyToken();
}

export interface ApifyResult {
  ok: boolean;
  item?: Record<string, unknown>;
  error?: string;
  status?: number;
}

export async function fetchPlaceViaApify(url: string): Promise<ApifyResult> {
  const token = apifyToken();
  if (!token) return { ok: false, error: "APIFY_TOKEN 이 설정되지 않았습니다." };

  // 액터가 인식하는 대표적인 입력 키들을 함께 넣는다(모르는 키는 대개 무시됨).
  // 리뷰 본문은 개수만 쓰므로 비용·시간 절약을 위해 최소화.
  const input = {
    startUrls: [{ url }],
    placeUrls: [url],
    maxPlaces: 1,
    maxItems: 1,
    includeReviews: false,
    scrapeReviews: false,
    maxReviews: 0,
    maxReviewsPerPlace: 0,
    includeMenu: true,
    // 업체 사진·소식을 받기 위한 best-effort 플래그(액터가 모르면 무시됨)
    includeImages: true,
    includePhotos: true,
    maxImages: 30,
    includeNews: true,
    includeFeed: true,
  };

  const endpoint =
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}&timeout=55&maxItems=3`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 58000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      return { ok: false, status: res.status, error: `Apify 오류 ${res.status} ${body}`.trim() };
    }
    const data = (await res.json()) as unknown;
    const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const item =
      items.find(
        (it) =>
          it &&
          typeof it === "object" &&
          ("name" in it || "placeName" in it || "category" in it || "roadAddress" in it),
      ) ?? items[0];
    if (!item) {
      return { ok: false, error: "결과가 비어 있습니다(액터가 장소를 찾지 못함)." };
    }
    return { ok: true, item };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}
