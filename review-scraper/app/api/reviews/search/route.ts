import { NextResponse } from "next/server";
import { searchPlaces, collectReviews, type Platform } from "@/lib/reviews";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  // TEMP: GET-accessible verification of a single platform's collect path.
  const debug = url.searchParams.get("debug");
  if (debug === "naver" || debug === "kakao" || debug === "google") {
    const collected = await collectReviews(q, [debug as Platform]);
    return NextResponse.json({ debug, collected });
  }

  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}
