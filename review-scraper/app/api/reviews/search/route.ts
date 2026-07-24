import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/reviews";
import { kakaoSearchPlaces } from "@/lib/reviews/adapters/kakao";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  // TEMP: probe Kakao review-list (pagination) endpoints to fetch >preview.
  if (url.searchParams.get("debug") === "kakaorev") {
    const cands = await kakaoSearchPlaces(q);
    const place = cands[0] ?? null;
    const H = {
      Accept: "application/json",
      pf: "web",
      Referer: "https://place.map.kakao.com/",
    };
    let panel: unknown = null;
    const others: unknown[] = [];
    if (place) {
      const id = place.placeId;
      try {
        const r = await fetch(
          `https://place-api.map.kakao.com/places/panel3/${id}`,
          { headers: H },
        );
        const j = (await r.json()) as Record<string, any>;
        const km = j.kakaomap_review ?? {};
        panel = {
          kakaomap_review: {
            reviews: Array.isArray(km.reviews) ? km.reviews.length : -1,
            review_count: km.score_set?.review_count,
            has_next: km.has_next,
            keys: Object.keys(km),
          },
          blog_review: {
            keys: Object.keys(j.blog_review ?? {}),
            snippet: JSON.stringify(j.blog_review).slice(0, 200),
          },
          visitor: {
            keys: Object.keys(j.visitor ?? {}),
            snippet: JSON.stringify(j.visitor).slice(0, 300),
          },
        };
      } catch (e) {
        panel = { error: String(e) };
      }
      const paramSets = [
        "?page=2&page_size=5",
        "?page=2&size=5",
        "?blog_review_page=2&blog_review_page_size=5",
        "?blogReviewPage=2&blogReviewSize=5",
      ];
      for (const ps of paramSets) {
        try {
          const r = await fetch(
            `https://place-api.map.kakao.com/places/panel3/${id}${ps}`,
            { headers: H },
          );
          const j = (await r.json()) as Record<string, any>;
          const br = j.blog_review ?? {};
          others.push({
            params: ps,
            status: r.status,
            requested_page: br.requested_page,
            requested_page_size: br.requested_page_size,
            firstReviewId: br.reviews?.[0]?.review_id,
            reviewCount: Array.isArray(br.reviews) ? br.reviews.length : -1,
          });
        } catch (e) {
          others.push({ params: ps, error: String(e) });
        }
      }
    }
    return NextResponse.json({ debug: "kakaorev", place, panel, others });
  }

  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}
