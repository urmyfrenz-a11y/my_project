import { NextResponse } from "next/server";
import { searchPlaces, collectReviews } from "@/lib/reviews";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  // TEMP: GET-accessible verification of the Kakao collect path.
  if (url.searchParams.get("debug") === "kakao") {
    const collected = await collectReviews(q, ["kakao"]);
    return NextResponse.json({ debug: true, collected });
  }

  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}
