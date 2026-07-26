import { config } from "@/lib/reviews/config";
import { kakaoSearchPlaces } from "@/lib/reviews/adapters/kakao";

export const runtime = "nodejs";
export const maxDuration = 60;

// TEMPORARY diagnostic: resolve a query -> Kakao placeId (server-side, we have
// KAKAO_REST_API_KEY), then hit the worker's /debug so we can see — from a host
// that CAN reach onrender.com — how many reviews the Playwright worker actually
// harvests, which APIs fired, and where the review data lives. This tells us if
// Kakao exposes >7 at all, or if we're just falling back to panel3.
// Usage: /api/reviews/kakao-worker-debug?q=CGV 동탄   — delete when done.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const out: Record<string, unknown> = {
    q,
    workerUrlSet: Boolean(config.kakao.workerUrl),
    workerTokenSet: Boolean(config.kakao.workerToken),
  };
  try {
    const places = await kakaoSearchPlaces(q);
    const place = places[0];
    out.placeId = place?.placeId ?? null;
    out.placeName = place?.name ?? null;
    if (!config.kakao.workerUrl) {
      out.note = "KAKAO_WORKER_URL not set in Vercel env";
      return Response.json(out);
    }
    if (!place) {
      out.note = "no place resolved for query";
      return Response.json(out);
    }
    const base = config.kakao.workerUrl.replace(/\/$/, "");
    const started = Date.now();
    // /debug needs no token; give it a long budget (worker scrape ~42s).
    const res = await fetch(
      `${base}/debug?placeId=${encodeURIComponent(place.placeId)}`,
      { signal: AbortSignal.timeout(58000) },
    );
    out.workerHttpStatus = res.status;
    out.roundTripMs = Date.now() - started;
    const data = (await res.json()) as Record<string, unknown>;
    out.reviewsCount = data.reviewsCount;
    out.sample = data.sample;
    out.debug = data.debug; // harvested, apiLog, jsonHosts, embedded, pageUrl…
  } catch (e) {
    out.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  return Response.json(out);
}
