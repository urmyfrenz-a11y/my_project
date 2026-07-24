import { config } from "../config";
import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { anonymizeAuthor, fetchWithTimeout, toIsoDate } from "../util";

// Naver blocks datacenter IPs (Vercel) with a captcha, so we can't fetch Naver
// Place directly. We route through Scrapingdog — a scraping API that fetches
// via a Korean residential IP and can render JS — so the request looks like a
// real Korean visitor. Free tier: 1,000 credits/mo (no card). Set
// SCRAPINGDOG_API_KEY to enable.

const SD = "https://api.scrapingdog.com/scrape";

/** Build a Scrapingdog request URL wrapping the real Naver URL. */
function sd(target: string, dynamic: boolean): string {
  const params = new URLSearchParams({
    api_key: config.naver.scrapingKey,
    url: target,
    country: "kr",
    premium: "true",
  });
  if (dynamic) params.set("dynamic", "true");
  return `${SD}?${params.toString()}`;
}

async function sdGet(
  target: string,
  dynamic: boolean,
  timeoutMs = 50000,
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetchWithTimeout(sd(target, dynamic), {}, timeoutMs);
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }
}

interface NaverPlace {
  id: string;
  name: string;
  type: string; // m.place.naver.com path segment (restaurant/place/hairshop…)
}

/** Resolve a query to a Naver place (id + name + type) via allSearch JSON. */
export async function resolveNaverPlace(
  query: string,
): Promise<NaverPlace | null> {
  const api =
    "https://map.naver.com/p/api/search/allSearch?type=all&searchCoord=&boundary=&query=" +
    encodeURIComponent(query);
  const { ok, body } = await sdGet(api, false, 40000);
  if (!ok) return null;
  try {
    const j = JSON.parse(body) as {
      result?: { place?: { list?: Array<Record<string, unknown>> } };
    };
    const first = j?.result?.place?.list?.[0];
    if (!first?.id) return null;
    // businessType is the m.place path segment; fall back to a generic "place".
    const type =
      (typeof first.businessType === "string" && first.businessType) ||
      (typeof first.category === "string" && "place") ||
      "place";
    return {
      id: String(first.id),
      name: (first.name as string) || query,
      type,
    };
  } catch {
    return null;
  }
}

/** Very defensive parse of visitor-review bodies from rendered review HTML. */
function parseReviews(html: string, placeId: string): UnifiedReview[] {
  const out: UnifiedReview[] = [];
  const seen = new Set<string>();
  // Naver mobile review bodies render inside spans with a data-pui-click-code
  // of "rvbody" (stable-ish), or generic review text spans. Try a few.
  const patterns = [
    /data-pui-click-code="rvbody"[^>]*>([\s\S]*?)<\/[a-z]+>/gi,
    /class="[^"]*pui__vn15t2[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && out.length < 100) {
      const text = m[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length < 4 || seen.has(text)) continue;
      seen.add(text);
      out.push({
        platform: "naver",
        placeId,
        reviewId: `n:${out.length}`,
        author: anonymizeAuthor(undefined),
        rating: null,
        text,
        source: "scrape",
      });
    }
    if (out.length > 0) break;
  }
  return out;
}

async function naverViaScrapingApi(query: string): Promise<CollectResult> {
  const place = await resolveNaverPlace(query);
  if (!place) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: "네이버에서 장소를 찾지 못했습니다.",
      errorCode: "NO_MATCH",
    };
  }
  const reviewUrl = `https://m.place.naver.com/${place.type}/${place.id}/review/visitor`;
  const { ok, body } = await sdGet(reviewUrl, true, 55000);
  const reviews = ok ? parseReviews(body, place.id) : [];
  if (reviews.length === 0) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: "네이버 리뷰를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      errorCode: "UPSTREAM_ERROR",
    };
  }
  return {
    platform: "naver",
    place: {
      platform: "naver",
      placeId: place.id,
      name: place.name,
      url: `https://m.place.naver.com/${place.type}/${place.id}/home`,
      reviewCount: reviews.length,
    },
    reviews,
    ok: true,
  };
}

/**
 * Diagnostic helper (used by /api/reviews/naver-debug). Returns the resolved
 * place plus a slice of the raw rendered HTML and the parse count, so we can
 * refine parseReviews against real Naver markup without shipping guesses.
 */
export async function naverDebug(query: string): Promise<{
  hasKey: boolean;
  place: NaverPlace | null;
  reviewUrl: string | null;
  status: number;
  bodyLength: number;
  parsed: number;
  htmlSample: string;
}> {
  if (!config.naver.scrapingKey) {
    return {
      hasKey: false,
      place: null,
      reviewUrl: null,
      status: 0,
      bodyLength: 0,
      parsed: 0,
      htmlSample: "",
    };
  }
  const place = await resolveNaverPlace(query);
  if (!place) {
    return {
      hasKey: true,
      place: null,
      reviewUrl: null,
      status: 0,
      bodyLength: 0,
      parsed: 0,
      htmlSample: "",
    };
  }
  const reviewUrl = `https://m.place.naver.com/${place.type}/${place.id}/review/visitor`;
  const { status, body } = await sdGet(reviewUrl, true, 55000);
  const parsed = parseReviews(body, place.id).length;
  // Grab a window around the first likely review marker to inspect real markup.
  const anchor = body.search(/rvbody|pui__|review|리뷰/i);
  const start = anchor > 400 ? anchor - 400 : 0;
  return {
    hasKey: true,
    place,
    reviewUrl,
    status,
    bodyLength: body.length,
    parsed,
    htmlSample: body.slice(start, start + 3000),
  };
}

interface WorkerResponse {
  place?: { placeId?: string; name?: string; url?: string } | null;
  reviews?: Array<{
    reviewId?: string;
    author?: string;
    text?: string;
    createdAt?: string;
  }>;
  error?: string;
}

async function naverViaWorker(query: string): Promise<CollectResult> {
  const base = config.naver.workerUrl.replace(/\/$/, "");
  try {
    const res = await fetchWithTimeout(
      `${base}/collect`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.naver.workerToken
            ? { "x-worker-token": config.naver.workerToken }
            : {}),
        },
        body: JSON.stringify({ query }),
      },
      55000,
    );
    if (!res.ok) {
      return {
        platform: "naver",
        place: null,
        reviews: [],
        ok: false,
        error: `네이버 워커 오류 (${res.status})`,
        errorCode: "UPSTREAM_ERROR",
      };
    }
    const data = (await res.json()) as WorkerResponse;
    const placeId = data.place?.placeId ?? "";
    const reviews: UnifiedReview[] = (data.reviews ?? [])
      .map((r, i) => ({
        platform: "naver" as const,
        placeId,
        reviewId: String(r.reviewId ?? `${placeId}:${i}`),
        author: anonymizeAuthor(r.author),
        rating: null,
        text: String(r.text ?? ""),
        createdAt: toIsoDate(r.createdAt),
        source: "scrape" as const,
      }))
      .filter((r) => r.text.trim());
    if (data.error && reviews.length === 0) {
      return {
        platform: "naver",
        place: null,
        reviews: [],
        ok: false,
        error: data.error,
        errorCode: "NO_MATCH",
      };
    }
    return {
      platform: "naver",
      place: data.place?.placeId
        ? {
            platform: "naver",
            placeId,
            name: data.place.name ?? query,
            url: data.place.url ?? `https://m.place.naver.com/place/${placeId}/home`,
            reviewCount: reviews.length,
          }
        : null,
      reviews,
      ok: true,
    };
  } catch (e) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      errorCode: "UPSTREAM_ERROR",
    };
  }
}

export async function naverCollect(
  query: string,
  _place?: PlaceSearchResult,
): Promise<CollectResult> {
  if (config.naver.scrapingKey) return naverViaScrapingApi(query);
  if (config.naver.workerUrl) return naverViaWorker(query);
  // Nothing configured → the UI shows the browser-extension guide instead.
  return {
    platform: "naver",
    place: null,
    reviews: [],
    ok: false,
    error:
      "네이버 플레이스는 브라우저 확장 또는 스크래핑 API(SCRAPINGDOG_API_KEY) 연결 시 수집됩니다.",
    errorCode: "SCRAPER_DISABLED",
  };
}
