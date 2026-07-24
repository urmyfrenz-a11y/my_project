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
    // Naver blocks datacenter IPs (Vercel/Render) with a captcha. To collect
    // Naver Place visitor reviews server-side we route through a scraping API
    // that fetches via a Korean residential IP + JS rendering. Scrapingdog has
    // a free tier (1,000 credits/mo, no card). Set SCRAPINGDOG_API_KEY.
    scrapingKey: process.env.SCRAPINGDOG_API_KEY ?? "",
    // Alternative: a self-run Playwright worker on a Korean residential IP
    // (see /naver-worker). Optional.
    workerUrl: process.env.NAVER_WORKER_URL ?? "",
    workerToken: process.env.NAVER_WORKER_TOKEN ?? "",
  },
} as const;
