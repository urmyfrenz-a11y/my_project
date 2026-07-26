/** Centralized env access so adapters never read process.env directly. */
export const config = {
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
  google: {
    // Google Maps has no official API for >5 reviews (the Places API caps
    // `reviews` at 5 per place). To collect up to 100 newest reviews we reuse
    // the same Apify token as Naver, calling the "Google Maps Reviews" actor
    // server-side. Pay-per-result, drawn from the same $5/mo free credit.
    apifyToken: process.env.APIFY_TOKEN ?? "",
  },
} as const;
