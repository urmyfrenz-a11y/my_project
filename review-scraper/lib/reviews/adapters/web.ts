import { config } from "../config";
import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { fetchWithTimeout, toIsoDate } from "../util";

// "인터넷 검색" source — key-light and LLM-free.
//
// Primary: Naver Search Open API (official JSON API). Bing/DuckDuckGo HTML
// scraping is blocked from Vercel's datacenter IPs, so the reliable path is
// Naver's Search API — free 25,000 calls/day, no overage billing, no bot
// detection. It returns Korean blog/web results (real place reviews). Set
// NAVER_SEARCH_CLIENT_ID/SECRET to enable it.
//
// Fallback: Bing then DuckDuckGo HTML (kept for local/other hosts; these
// usually fail from Vercel but are harmless to try). If everything comes back
// empty we surface a friendly message instead of a hard error.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// How many web results to keep per search. Naver's API allows up to 100 per
// call (and ~1,000 via pagination); this is just where we cap collection.
const MAX_RESULTS = 100;

/** Map a hostname (or Bing <cite> text) to a friendly Korean source label. */
function sourceName(hostOrUrl: string): string {
  let h = hostOrUrl;
  try {
    h = new URL(hostOrUrl).hostname;
  } catch {
    h = (hostOrUrl.match(/[a-z0-9.-]+\.[a-z]{2,}/i) ?? [""])[0];
  }
  h = h.replace(/^www\./, "").toLowerCase();
  const map: Record<string, string> = {
    "blog.naver.com": "네이버블로그",
    "cafe.naver.com": "네이버카페",
    "post.naver.com": "네이버포스트",
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

/* ── relevance guard ──────────────────────────────────────
 * Naver blog/web search returns anything that partially matches the keywords:
 * for "커피에반하다 광교호수공원점" it also surfaces posts about 오공김밥 청라호수공원점,
 * 우지커피 광교호수공원점, 순천호수공원점 (they share 호수공원/커피/광교). Those are
 * other stores, so mixing them corrupts the review set. We keep only results
 * whose text carries every meaningful token of the place name (brand + branch),
 * tolerating a trailing 점/지점/본점 suffix. */
function normText(s: string): string {
  return (s || "").toLowerCase().replace(/[\s\-_.,·'"()[\]]/g, "");
}
const WEB_BRANCH_SUFFIX = /(본점|직영점|지점|점)$/;
function relevantToPlace(query: string, text: string): boolean {
  const n = normText(text);
  if (!n) return false;
  const tokens = query.split(/\s+/).filter((t) => normText(t).length >= 2);
  if (tokens.length === 0) {
    const q = normText(query);
    return q.length >= 2 && n.includes(q);
  }
  return tokens.every((t) => {
    const nt = normText(t);
    if (n.includes(nt)) return true;
    const stripped = nt.replace(WEB_BRANCH_SUFFIX, "");
    return stripped.length >= 2 && n.includes(stripped);
  });
}

function push(
  out: UnifiedReview[],
  seen: Set<string>,
  query: string,
  host: string,
  title: string,
  snippet: string,
  createdAt?: string,
) {
  const text = [title, snippet].filter(Boolean).join(" — ");
  if (!text || seen.has(text)) return;
  // Drop results that aren't actually about this place (see relevance guard).
  if (!relevantToPlace(query, text)) return;
  seen.add(text);
  out.push({
    platform: "web",
    placeId: query,
    reviewId: `w:${out.length}`,
    author: sourceName(host),
    rating: null,
    text,
    createdAt,
    source: "scrape",
  });
}

interface NaverItem {
  title?: string;
  link?: string;
  description?: string;
  postdate?: string; // YYYYMMDD
}

/** Naver Search Open API — primary, reliable engine (needs free app keys). */
async function naverApi(query: string): Promise<UnifiedReview[]> {
  const { clientId, clientSecret } = config.naverSearch;
  if (!clientId || !clientSecret) return [];
  const headers = {
    "X-Naver-Client-Id": clientId,
    "X-Naver-Client-Secret": clientSecret,
    Accept: "application/json",
  };
  const q = encodeURIComponent(query + " 후기 리뷰");
  const out: UnifiedReview[] = [];
  const seen = new Set<string>();
  // The relevance filter (in push) drops off-topic posts, so a single page of
  // 100 raw results often yields far fewer. Paginate (Naver allows start up to
  // 1000) so we still reach MAX_RESULTS *relevant* posts. Blog first (most
  // review-like), then general web docs to top up.
  const MAX_PAGES = 5; // up to 500 raw per kind
  for (const kind of ["blog", "webkr"]) {
    for (let page = 0; page < MAX_PAGES && out.length < MAX_RESULTS; page++) {
      const start = 1 + page * 100;
      let items: NaverItem[] = [];
      try {
        const res = await fetchWithTimeout(
          `https://openapi.naver.com/v1/search/${kind}.json?query=${q}&display=100&start=${start}&sort=sim`,
          { headers },
          10000,
        );
        if (!res.ok) break;
        const data = (await res.json()) as { items?: NaverItem[] };
        items = data.items ?? [];
      } catch {
        break; // try next kind
      }
      if (items.length === 0) break; // no more results for this kind
      for (const it of items) {
        if (out.length >= MAX_RESULTS) break;
        const created =
          it.postdate && /^\d{8}$/.test(it.postdate)
            ? toIsoDate(
                `${it.postdate.slice(0, 4)}-${it.postdate.slice(4, 6)}-${it.postdate.slice(6, 8)}`,
              )
            : undefined;
        push(
          out,
          seen,
          query,
          it.link ?? "",
          clean(it.title ?? ""),
          clean(it.description ?? ""),
          created,
        );
      }
      if (items.length < 100) break; // last page for this kind
    }
  }
  return out;
}

/** Bing organic results — best-effort fallback. */
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
  for (const b of html.split('class="b_algo"').slice(1)) {
    if (out.length >= MAX_RESULTS) break;
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

/** DuckDuckGo HTML — last-resort fallback. */
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
  while ((m = re.exec(html)) !== null && out.length < MAX_RESULTS) {
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
  const hasNaver = Boolean(
    config.naverSearch.clientId && config.naverSearch.clientSecret,
  );
  const engines = hasNaver ? [naverApi, bing, duck] : [bing, duck];

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
      error: hasNaver
        ? "지금 네이버 검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해주세요."
        : "네이버 검색 준비중 — 네이버 검색 오픈API 키(NAVER_SEARCH_CLIENT_ID/SECRET)를 넣으면 활성화됩니다.",
      errorCode: hasNaver ? "UPSTREAM_ERROR" : "MISSING_KEY",
    };
  }

  return {
    platform: "web",
    place: {
      platform: "web",
      placeId: query,
      name: `"${query}" 네이버 검색`,
      reviewCount: reviews.length,
    },
    reviews,
    ok: true,
  };
}
