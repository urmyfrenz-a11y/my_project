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
    const probes: unknown[] = [];
    if (place) {
      const id = place.placeId;
      const H = {
        Accept: "application/json",
        pf: "web",
        Referer: "https://place.map.kakao.com/",
      };
      const urls = [
        `https://place-api.map.kakao.com/places/kakaomap_reviews/${id}?order=RECENT&onlyPhotoReview=false&size=20`,
        `https://place-api.map.kakao.com/places/kakaomap_reviews/${id}?order=RECOMMEND&size=20&page=1`,
        `https://place-api.map.kakao.com/places/kakaomapReviews/${id}?size=20`,
        `https://place-api.map.kakao.com/places/reviews/${id}?order=RECENT&size=20`,
        `https://place-api.map.kakao.com/places/review/${id}?size=20`,
        `https://place-api.map.kakao.com/places/visitor/${id}?size=20`,
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
              const revs =
                j.reviews ?? j.kakaomap_review?.reviews ?? j.list ?? j.items;
              reviewCount = Array.isArray(revs) ? revs.length : -1;
            } catch {
              /* ignore */
            }
          }
          probes.push({
            url: u,
            status: r.status,
            keys,
            reviewCount,
            snippet: body.slice(0, 220),
          });
        } catch (e) {
          probes.push({ url: u, error: String(e) });
        }
      }
    }
    return NextResponse.json({ debug: "kakaorev", place, probes });
  }

  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}
