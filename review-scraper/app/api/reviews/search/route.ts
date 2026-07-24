import { NextResponse } from "next/server";
import { searchPlaces, collectReviews } from "@/lib/reviews";
import { kakaoSearchPlaces } from "@/lib/reviews/adapters/kakao";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  // TEMP diagnostic channel (GET-accessible) to inspect Kakao's raw review
  // response shape and verify the collect path. Remove after verification.
  if (url.searchParams.get("debug") === "kakao") {
    const cands = await kakaoSearchPlaces(q);
    const place = cands[0] ?? null;
    let raw: { status: number; commentKeys: string[]; counts: Record<string, number>; sample: unknown } | null = null;
    if (place) {
      const r = await fetch(`https://place.map.kakao.com/main/v/${place.placeId}`, {
        headers: {
          Referer: `https://place.map.kakao.com/${place.placeId}`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
        },
      });
      let j: unknown = null;
      try {
        j = await r.json();
      } catch {
        j = null;
      }
      const c = (j as { comment?: Record<string, unknown> })?.comment ?? {};
      raw = {
        status: r.status,
        commentKeys: Object.keys(c),
        counts: {
          kamapComntList: Array.isArray((c as { kamapComntList?: unknown[] }).kamapComntList)
            ? (c as { kamapComntList: unknown[] }).kamapComntList.length
            : -1,
          list: Array.isArray((c as { list?: unknown[] }).list)
            ? (c as { list: unknown[] }).list.length
            : -1,
        },
        sample:
          (c as { kamapComntList?: unknown[] }).kamapComntList?.[0] ??
          (c as { list?: unknown[] }).list?.[0] ??
          null,
      };
    }
    const collected = await collectReviews(q, ["kakao"]);
    return NextResponse.json({ debug: true, place, raw, collected });
  }

  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}
