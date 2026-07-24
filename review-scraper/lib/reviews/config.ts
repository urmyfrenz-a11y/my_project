/** Centralized env access so adapters never read process.env directly. */
export const config = {
  google: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
  },
  kakao: {
    restKey: process.env.KAKAO_REST_API_KEY ?? "",
  },
  naver: {
    // Playwright can't run on Vercel serverless; gate it explicitly so the
    // rest of the site deploys and works even when the scraper is off.
    enabled: process.env.NAVER_SCRAPER_ENABLED === "true",
    // Optional: point at the pre-installed Chromium in this environment.
    chromiumPath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "",
    maxReviews: Number(process.env.NAVER_MAX_REVIEWS ?? "40"),
  },
} as const;
