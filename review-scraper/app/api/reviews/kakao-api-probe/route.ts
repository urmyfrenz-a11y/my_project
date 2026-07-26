import { config } from "@/lib/reviews/config";
import { kakaoSearchPlaces } from "@/lib/reviews/adapters/kakao";

export const runtime = "nodejs";
export const maxDuration = 30;

// TEMPORARY: probe Kakao's review APIs directly from the server (Vercel can
// reach place-api.map.kakao.com). Goal: find whether a *paginated* review
// endpoint exists beyond panel3's ~7. Reports panel3's full structure (total
// counts, pagination hints) plus the status/shape of several candidate
// comment-list endpoints. Delete once we know the right endpoint.
//   /api/reviews/kakao-api-probe?q=CGV 동탄   (or ?id=13324379)

const H = {
  Accept: "application/json",
  pf: "web",
  Referer: "https://place.map.kakao.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

async function probe(url: string) {
  try {
    const res = await fetch(url, { headers: H });
    const ct = res.headers.get("content-type") ?? "";
    const body = await res.text();
    let json: unknown = null;
    if (ct.includes("json")) {
      try {
        json = JSON.parse(body);
      } catch {
        /* not json */
      }
    }
    return {
      url,
      status: res.status,
      ct: ct.slice(0, 40),
      len: body.length,
      // top-level keys if json, else a text snippet
      keys: json && typeof json === "object" ? Object.keys(json as object) : null,
      snippet: json ? undefined : body.slice(0, 200),
    };
  } catch (e) {
    return { url, error: e instanceof Error ? e.message : String(e) };
  }
}

// Summarize panel3 so we can see review totals and how many bodies it ships.
async function panel3Detail(id: string) {
  const url = `https://place-api.map.kakao.com/places/panel3/${id}`;
  try {
    const res = await fetch(url, { headers: H });
    const data = (await res.json()) as Record<string, any>;
    const km = data?.kakaomap_review ?? {};
    const bl = data?.blog_review ?? {};
    return {
      status: res.status,
      topKeys: Object.keys(data ?? {}),
      kakaomap_review_keys: Object.keys(km),
      blog_review_keys: Object.keys(bl),
      // Look for a total count vs how many review bodies are actually present.
      kakaomap_scoresum: km.scoresum,
      kakaomap_scorecnt: km.scorecnt,
      kakaomap_review_count: km.review_count ?? km.total_count ?? km.cnt,
      kakaomap_reviews_in_payload: Array.isArray(km.reviews) ? km.reviews.length : null,
      blog_review_count: bl.review_count ?? bl.total_count ?? bl.cnt,
      blog_reviews_in_payload: Array.isArray(bl.reviews) ? bl.reviews.length : null,
      // A sample review object so we can see field names (ids for pagination).
      sample_review_keys:
        Array.isArray(km.reviews) && km.reviews[0]
          ? Object.keys(km.reviews[0])
          : null,
      sample_review: Array.isArray(km.reviews) ? km.reviews[0] : null,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  let id = (sp.get("id") ?? "").trim();
  const q = (sp.get("q") ?? "").trim();
  const out: Record<string, unknown> = {};
  if (!id && q) {
    const places = await kakaoSearchPlaces(q);
    id = places[0]?.placeId ?? "";
    out.resolvedFrom = q;
    out.placeName = places[0]?.name ?? null;
  }
  out.placeId = id;
  if (!id) {
    out.note = "no placeId (pass ?id= or ?q=, and KAKAO_REST_API_KEY must be set)";
    return Response.json(out);
  }

  out.panel3 = await panel3Detail(id);

  // Candidate endpoints that might page past 7. We only read status/shape.
  const candidates = [
    `https://place-api.map.kakao.com/places/panel3/${id}?page=2`,
    `https://place-api.map.kakao.com/places/panel4/${id}`,
    `https://place-api.map.kakao.com/places/main/v/${id}`,
    `https://place-api.map.kakao.com/places/${id}/comments`,
    `https://place-api.map.kakao.com/places/${id}/reviews`,
    `https://place.map.kakao.com/commentlist/v/${id}`,
    `https://place.map.kakao.com/commentlist/v/${id}/0`,
    `https://place.map.kakao.com/main/v/${id}`,
  ];
  out.candidates = [];
  for (const url of candidates) {
    (out.candidates as unknown[]).push(await probe(url));
  }
  out.configuredKakaoRestKey = Boolean(config.kakao.restKey);
  return Response.json(out);
}
