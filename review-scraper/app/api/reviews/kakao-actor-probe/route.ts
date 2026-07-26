import { config } from "@/lib/reviews/config";

export const runtime = "nodejs";
export const maxDuration = 30;

// TEMPORARY diagnostic endpoint: search the Apify Store for Kakao-related
// actors so we can see, from a host that can actually reach api.apify.com,
// whether a maintained Kakao Map reviews actor exists (and what it scrapes).
// Delete this route once the investigation is done.
interface StoreActor {
  name?: string;
  username?: string;
  title?: string;
  description?: string;
  stats?: { totalRuns?: number };
}

async function search(term: string, token: string) {
  const url =
    `https://api.apify.com/v2/store?search=${encodeURIComponent(term)}` +
    `&limit=25&token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return { term, ok: false, status: res.status, items: [] };
  const data = (await res.json()) as { data?: { items?: StoreActor[] } };
  const items = (data.data?.items ?? []).map((a) => ({
    id: `${a.username}/${a.name}`,
    title: a.title,
    runs: a.stats?.totalRuns,
    desc: (a.description ?? "").slice(0, 180),
  }));
  return { term, ok: true, count: items.length, items };
}

export async function GET() {
  const token = config.google.apifyToken; // same APIFY_TOKEN
  if (!token) {
    return Response.json({ error: "no APIFY_TOKEN" }, { status: 400 });
  }
  const terms = ["kakao", "카카오", "kakaomap", "kakao map", "korea review"];
  const results = [];
  for (const t of terms) {
    try {
      results.push(await search(t, token));
    } catch (e) {
      results.push({ term: t, ok: false, error: String(e) });
    }
  }
  return Response.json({ results });
}
