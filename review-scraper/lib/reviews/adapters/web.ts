import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { fetchWithTimeout } from "../util";

// "인터넷 검색" source — completely key-free and LLM-free.
// We fetch DuckDuckGo's HTML results server-side (no API key, no quota, no
// billing) and treat each result (title + snippet) as a collected text item
// that ships in the downloadable .txt alongside the map reviews.
//
// DuckDuckGo doesn't require a key and doesn't meter usage, so there's no
// "free tier" to exhaust. If it ever fails to answer (network hiccup or a
// datacenter-IP rate-limit), we surface a friendly "try again later" message
// instead of a hard error.
const DDG_HTML = "https://html.duckduckgo.com/html/";

/** Map a result hostname to a friendly Korean source label. */
function sourceName(link: string): string {
  try {
    const h = new URL(link).hostname.replace(/^www\./, "");
    const map: Record<string, string> = {
      "blog.naver.com": "네이버블로그",
      "cafe.naver.com": "네이버카페",
      "tistory.com": "티스토리",
      "youtube.com": "유튜브",
      "instagram.com": "인스타그램",
      "brunch.co.kr": "브런치",
      "mangoplate.com": "망고플레이트",
      "diningcode.com": "다이닝코드",
      "google.com": "구글",
    };
    for (const k in map) if (h.endsWith(k)) return map[k];
    return h;
  } catch {
    return "웹";
  }
}

/** Minimal HTML-entity decode + tag strip (no DOM dependency). */
function clean(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo wraps result links in a /l/?uddg=<encoded-url> redirect. */
function unwrap(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through */
    }
  }
  return href.startsWith("//") ? "https:" + href : href;
}

/** Empty stub kept for the (legacy) place-candidate search endpoint. */
export async function webSearchPlaces(): Promise<PlaceSearchResult[]> {
  return [];
}

export async function webCollect(query: string): Promise<CollectResult> {
  const tryLater =
    "지금 인터넷 검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
  try {
    const res = await fetchWithTimeout(
      `${DDG_HTML}?q=${encodeURIComponent(query + " 후기 리뷰")}&kl=kr-kr`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9",
        },
      },
      12000,
    );
    if (!res.ok) {
      return {
        platform: "web",
        place: null,
        reviews: [],
        ok: false,
        error: tryLater,
        errorCode: "UPSTREAM_ERROR",
      };
    }
    const html = await res.text();

    // Each result: a result__a anchor (title, carries the href) followed by a
    // result__snippet anchor. Capture the title anchor's full attribute list so
    // href extraction doesn't depend on attribute ordering.
    const re =
      /<a\b([^>]*\bclass="result__a"[^>]*)>([\s\S]*?)<\/a>[\s\S]*?<a\b[^>]*\bclass="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const reviews: UnifiedReview[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && reviews.length < 20) {
      const hrefMatch = m[1].match(/\bhref="([^"]+)"/);
      const link = unwrap(hrefMatch ? hrefMatch[1] : "");
      const title = clean(m[2]);
      const snippet = clean(m[3]);
      const text = [title, snippet].filter(Boolean).join(" — ");
      if (!text || seen.has(text)) continue;
      seen.add(text);
      reviews.push({
        platform: "web",
        placeId: query,
        reviewId: `w:${reviews.length}`,
        author: sourceName(link),
        rating: null,
        text,
        source: "scrape",
      });
    }

    const place: PlaceSearchResult = {
      platform: "web",
      placeId: query,
      name: `"${query}" 인터넷 검색`,
      reviewCount: reviews.length,
    };
    return { platform: "web", place, reviews, ok: true };
  } catch {
    return {
      platform: "web",
      place: null,
      reviews: [],
      ok: false,
      error: tryLater,
      errorCode: "UPSTREAM_ERROR",
    };
  }
}
