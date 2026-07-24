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
      const urls = [
        `https://place-api.map.kakao.com/places/kakaomap_review/${id}?order=RECENT&onlyPhotoReview=false&page=1&size=20`,
        `https://place-api.map.kakao.com/places/blog_review/${id}?page=1&size=20`,
        `https://place-api.map.kakao.com/places/kakaomap_review/${id}?page=1&size=20&onlyPhotoReview=false`,
      ];
      for (const u of urls) {
        try {
          const r = await fetch(u, { headers: H });
          const ct = r.headers.get("content-type") ?? "";
          const body = await r.text();
          let keys: string[] = [];
          let reviewCount = -1;
          if (ct.includes("json")) {
            try {
              const j = JSON.parse(body);
              keys = Object.keys(j);
              const revs = j.reviews ?? j.list ?? j.items;
              reviewCount = Array.isArray(revs) ? revs.length : -1;
            } catch {
              /* ignore */
            }
          }
          others.push({
            url: u,
            status: r.status,
            keys,
            reviewCount,
            snippet: body.slice(0, 160),
          });
        } catch (e) {
          others.push({ url: u, error: String(e) });
        }
      }
    }
    return NextResponse.json({ debug: "kakaorev", place, panel, others });
  }

  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}
