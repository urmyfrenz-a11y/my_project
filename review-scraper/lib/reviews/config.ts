/** Centralized env access so adapters never read process.env directly. */
export const config = {
  // "인터넷 검색" source. Bing/DuckDuckGo scraping is blocked from Vercel's
  // datacenter IPs, so we use Naver's official Search Open API (free 25,000
  // calls/day, no overage billing, no bot-detection). Register a free app at
  // https://developers.naver.com/apps and set these two vars. Without them the
  // source shows "준비중".
  naverSearch: {
    clientId: process.env.NAVER_SEARCH_CLIENT_ID ?? "",
    clientSecret: process.env.NAVER_SEARCH_CLIENT_SECRET ?? "",
  },
  kakao: {
    restKey: process.env.KAKAO_REST_API_KEY ?? "",
  },
  naver: {
    // Naver has no official API for Place visitor reviews and blocks datacenter
    // IPs. The stable path is the Apify "Naver Place Reviews" actor, which we
    // call server-side (it resolves the place from a keyword and returns visitor
    // reviews). Free tier: $5/mo (~5,000 reviews at $1/1,000). Set APIFY_TOKEN.
    apifyToken: process.env.APIFY_TOKEN ?? "",
    // Legacy/optional fallbacks (Scrapingdog scraping, self-run worker).
    scrapingKey: process.env.SCRAPINGDOG_API_KEY ?? "",
    workerUrl: process.env.NAVER_WORKER_URL ?? "",
    workerToken: process.env.NAVER_WORKER_TOKEN ?? "",
  },
} as const;
