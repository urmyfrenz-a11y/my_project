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

/**
 * Extract the first Naver place (id + m.place path segment) from a rendered
 * search-results HTML page. Naver embeds links like
 * `m.place.naver.com/restaurant/1234567890/home` for each result.
 */
function extractPlaceFromHtml(html: string, query: string): NaverPlace | null {
  const patterns = [
    /(?:m\.place|pcmap\.place|place)\.naver\.com\/([a-z]+)\/(\d{6,})/i,
    /"(?:type|businessCategory)"\s*:\s*"([a-z]+)"[^}]*?"id"\s*:\s*"?(\d{6,})/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return { id: m[2], name: query, type: m[1].toLowerCase() };
  }
  // Last resort: a bare place id in embedded JSON.
  const bare = /"(?:placeId|entryId|id)"\s*:\s*"?(\d{7,})"?/i.exec(html);
  if (bare) return { id: bare[1], name: query, type: "place" };
  return null;
}

/**
 * Resolve a query to a Naver place. Naver's internal search APIs return 403
 * without a browser context, so we fetch the user-facing mobile search page
 * (rendered via Scrapingdog) and scrape the first place link out of it.
 */
export async function resolveNaverPlace(
  query: string,
): Promise<NaverPlace | null> {
  const searchUrl =
    "https://m.search.naver.com/search.naver?query=" + encodeURIComponent(query);
  const { ok, body } = await sdGet(searchUrl, true, 50000);
  if (!ok) return null;
  return extractPlaceFromHtml(body, query);
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
export async function naverDebug(query: string): Promise<Record<string, unknown>> {
  if (!config.naver.scrapingKey) return { hasKey: false };

  // Step 1: fetch the mobile search page (browser-rendered) and extract place.
  const searchUrl =
    "https://m.search.naver.com/search.naver?query=" + encodeURIComponent(query);
  const search = await sdGet(searchUrl, true, 50000);
  const place = search.ok ? extractPlaceFromHtml(search.body, query) : null;
  // Sample around the first place link so we can tune the extractor if needed.
  const linkAt = search.body.search(/place\.naver\.com\/[a-z]+\/\d+/i);
  const sampleStart = linkAt > 300 ? linkAt - 300 : 0;

  const out: Record<string, unknown> = {
    hasKey: true,
    query,
    search: {
      ok: search.ok,
      status: search.status,
      bodyLength: search.body.length,
      hasPlaceLink: linkAt >= 0,
      sample: search.body.slice(sampleStart, sampleStart + 1500),
    },
    place,
  };

  // Step 2: if resolved, fetch the review page and sample its HTML.
  if (place) {
    const reviewUrl = `https://m.place.naver.com/${place.type}/${place.id}/review/visitor`;
    const rev = await sdGet(reviewUrl, true, 55000);
    const parsed = parseReviews(rev.body, place.id);
    const anchor = rev.body.search(/rvbody|pui__|review|리뷰|평점|방문/i);
    const start = anchor > 500 ? anchor - 500 : 0;
    out.review = {
      reviewUrl,
      ok: rev.ok,
      status: rev.status,
      bodyLength: rev.body.length,
      parsedCount: parsed.length,
      firstParsed: parsed.slice(0, 3).map((r) => r.text),
      htmlSample: rev.body.slice(start, start + 4000),
    };
  }
  return out;
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
