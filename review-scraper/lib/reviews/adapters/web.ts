import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { fetchWithTimeout } from "../util";

// "인터넷 검색" source — completely key-free and LLM-free.
// We fetch a search engine's HTML results server-side (no API key, no quota,
// no billing) and treat each result (title + snippet) as a collected text item
// that ships in the downloadable .txt alongside the map reviews.
//
// Engine order matters: Bing tolerates server-side/datacenter requests far
// better than DuckDuckGo or Google, so we try it first and fall back to
// DuckDuckGo. No engine needs a key and none meters usage, so there's no free
// tier to exhaust. If they all fail (network/IP block), we surface a friendly
// "try again later" message instead of a hard error.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Map a hostname (or Bing <cite> text) to a friendly Korean source label. */
function sourceName(hostOrUrl: string): string {
  let h = hostOrUrl;
  try {
    h = new URL(hostOrUrl).hostname;
  } catch {
    // Not a full URL (e.g. Bing cite "blog.naver.com › ..."): take the first
    // domain-looking token.
    h = (hostOrUrl.match(/[a-z0-9.-]+\.[a-z]{2,}/i) ?? [""])[0];
  }
  h = h.replace(/^www\./, "").toLowerCase();
  const map: Record<string, string> = {
    "blog.naver.com": "네이버블로그",
    "cafe.naver.com": "네이버카페",
    "tistory.com": "티스토리",
    "youtube.com": "유튜브",
    "instagram.com": "인스타그램",
    "brunch.co.kr": "브런치",
    "mangoplate.com": "망고플레이트",
    "diningcode.com": "다이닝코드",
  };
  for (const k in map) if (h.endsWith(k)) return map[k];
  return h || "웹";
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

function push(
  out: UnifiedReview[],
  seen: Set<string>,
  query: string,
  host: string,
  title: string,
  snippet: string,
) {
  const text = [title, snippet].filter(Boolean).join(" — ");
  if (!text || seen.has(text)) return;
  seen.add(text);
  out.push({
    platform: "web",
    placeId: query,
    reviewId: `w:${out.length}`,
    author: sourceName(host),
    rating: null,
    text,
    source: "scrape",
  });
}

/** Bing organic results — the most datacenter-friendly engine. */
async function bing(query: string): Promise<UnifiedReview[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(
    query + " 후기 리뷰",
  )}&setlang=ko&cc=KR&count=20`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    },
    10000,
  );
  if (!res.ok) return [];
  const html = await res.text();
  const out: UnifiedReview[] = [];
  const seen = new Set<string>();
  // Split on each organic result container, parse fields inside the block.
  for (const b of html.split('class="b_algo"').slice(1)) {
    if (out.length >= 20) break;
    const title = clean((b.match(/<h2\b[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/) ?? [])[1] ?? "");
    const cite = clean((b.match(/<cite\b[^>]*>([\s\S]*?)<\/cite>/) ?? [])[1] ?? "");
    const href = (b.match(/<h2\b[\s\S]*?<a\b[^>]*href="([^"]+)"/) ?? [])[1] ?? "";
    const snippet = clean(
      (b.match(/<p\b[^>]*class="[^"]*b_[^"]*"[^>]*>([\s\S]*?)<\/p>/) ??
        b.match(/<p\b[^>]*>([\s\S]*?)<\/p>/) ??
        [])[1] ?? "",
    );
    push(out, seen, query, cite || href, title, snippet);
  }
  return out;
}

/** DuckDuckGo HTML — fallback (often blocks datacenter IPs, hence second). */
async function duck(query: string): Promise<UnifiedReview[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
    query + " 후기 리뷰",
  )}&kl=kr-kr`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    },
    10000,
  );
  if (!res.ok) return [];
  const html = await res.text();
  const out: UnifiedReview[] = [];
  const seen = new Set<string>();
  const re =
    /<a\b([^>]*\bclass="result__a"[^>]*)>([\s\S]*?)<\/a>[\s\S]*?<a\b[^>]*\bclass="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < 20) {
    const hrefRaw = (m[1].match(/\bhref="([^"]+)"/) ?? [])[1] ?? "";
    const uddg = hrefRaw.match(/[?&]uddg=([^&]+)/);
    let link = hrefRaw;
    if (uddg) {
      try {
        link = decodeURIComponent(uddg[1]);
      } catch {
        /* keep raw */
      }
    }
    push(out, seen, query, link, clean(m[2]), clean(m[3]));
  }
  return out;
}

/** Empty stub kept for the (legacy) place-candidate search endpoint. */
export async function webSearchPlaces(): Promise<PlaceSearchResult[]> {
  return [];
}

export async function webCollect(
  query: string,
  _place?: PlaceSearchResult,
): Promise<CollectResult> {
  const engines = [bing, duck];
  let reviews: UnifiedReview[] = [];
  for (const engine of engines) {
    try {
      reviews = await engine(query);
      if (reviews.length > 0) break;
    } catch {
      /* try next engine */
    }
  }

  if (reviews.length === 0) {
    return {
      platform: "web",
      place: null,
      reviews: [],
      ok: false,
      error:
        "지금 인터넷 검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      errorCode: "UPSTREAM_ERROR",
    };
  }

  return {
    platform: "web",
    place: {
      platform: "web",
      placeId: query,
      name: `"${query}" 인터넷 검색`,
      reviewCount: reviews.length,
    },
    reviews,
    ok: true,
  };
}
