export const runtime = "nodejs";
export const maxDuration = 60;

// TEMPORARY diagnostic: the Naver Apify actor returned 0 items for a place that
// clearly has reviews. Check the actor's metadata (deprecated? renamed?) and do
// a live run with a well-known place to tell "actor/input broken" apart from
// "this specific place isn't resolved". Delete after diagnosis.
//   /api/reviews/naver-actor-probe?q=스타벅스 광교
const ACTOR = "huggable_quote~naver-place-reviews-scraper";

export async function GET(req: Request) {
  const token = process.env.APIFY_TOKEN ?? "";
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "스타벅스 광교").trim();
  const includeBlog = sp.get("blog") === "1";
  const out: Record<string, unknown> = {
    actor: ACTOR,
    q,
    includeBlog,
    hasToken: Boolean(token),
  };
  if (!token) return Response.json(out);

  // 1) Actor metadata — is it deprecated / still there?
  try {
    const m = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}?token=${encodeURIComponent(token)}`,
    );
    out.metaStatus = m.status;
    if (m.ok) {
      const j = (await m.json()) as { data?: Record<string, unknown> };
      const d = j.data ?? {};
      out.meta = {
        name: d.name,
        title: d.title,
        username: d.username,
        isDeprecated: d.isDeprecated,
        isPublic: d.isPublic,
      };
    } else {
      out.metaBody = (await m.text()).slice(0, 300);
    }
  } catch (e) {
    out.metaErr = String((e as Error)?.message || e);
  }

  // 2) Live run with the current input shape.
  // If a Naver place URL is given, drive the actor by URL (bypasses keyword
  // resolution); try the two common param shapes. Otherwise search by keyword.
  const naverUrl = (sp.get("url") ?? "").trim();
  out.mode = naverUrl ? "url" : "keyword";
  const input: Record<string, unknown> = naverUrl
    ? {
        startUrls: [{ url: naverUrl }],
        placeUrls: [naverUrl],
        maxReviewPages: 3,
        reviewSort: "NEWEST",
        includeBlogReviews: includeBlog,
      }
    : {
        searchKeywords: [q],
        maxPlacesPerKeyword: 1,
        maxReviewPages: 3,
        reviewSort: "NEWEST",
        includeBlogReviews: includeBlog,
      };
  try {
    const r = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
        `?token=${encodeURIComponent(token)}&timeout=50&maxItems=20`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    out.runStatus = r.status;
    const t = await r.text();
    let items: unknown = null;
    try {
      items = JSON.parse(t);
    } catch {
      /* not json */
    }
    if (Array.isArray(items)) {
      out.itemCount = items.length;
      const first = items[0] as Record<string, unknown> | undefined;
      out.firstItemKeys = first ? Object.keys(first) : null;
      out.firstItem = first ?? null;
      // Break down by reviewType (visitor vs blog) + the place it resolved to.
      const byType: Record<string, number> = {};
      for (const it of items as Record<string, unknown>[]) {
        const t = String(it.reviewType ?? "?");
        byType[t] = (byType[t] ?? 0) + 1;
      }
      out.byReviewType = byType;
      out.resolvedPlace = first
        ? { name: first.placeName, total: first.placeTotalReviews, url: first.placeUrl }
        : null;
    } else {
      out.runBody = t.slice(0, 500);
    }
  } catch (e) {
    out.runErr = String((e as Error)?.message || e);
  }
  return Response.json(out);
}
