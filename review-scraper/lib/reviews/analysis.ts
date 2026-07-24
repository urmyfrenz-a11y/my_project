// Lightweight, dependency-free (no API key) Korean review analysis:
// sentiment ratio + keyword frequency + a templated combined insight.
// Runs in the browser on already-collected reviews.

import type { CollectResult, Platform, UnifiedReview } from "./types";

export const PLATFORM_LABEL: Record<Platform, string> = {
  google: "구글 검색",
  kakao: "카카오맵",
  naver: "네이버 플레이스",
};

const POSITIVE = [
  "맛있", "맛집", "좋", "최고", "추천", "만족", "훌륭", "친절", "깔끔", "청결",
  "신선", "재방문", "또 가", "또가", "분위기", "가성비", "편안", "완벽", "감동",
  "행복", "굿", "정성", "넓", "빠르", "저렴", "괜찮", "인생", "부드럽", "든든",
  "예쁘", "이쁘", "친근", "쾌적", "푸짐", "실하", "감사", "대박",
];
const NEGATIVE = [
  "별로", "비싸", "불친절", "실망", "최악", "느리", "더럽", "지저분", "좁", "짜",
  "맛없", "불편", "아쉽", "형편없", "다신", "다시는", "안 가", "안가", "화나",
  "짜증", "위생", "불량", "느끼", "질기", "비추", "그저 그", "별로에요", "웨이팅",
  "오래 기다", "불쾌", "냄새", "시끄", "부족",
];

const STOP = new Set([
  "그리고", "하지만", "그래서", "그런데", "근데", "정말", "진짜", "너무", "조금",
  "약간", "그냥", "여기", "거기", "저기", "이곳", "매장", "가게", "사장님", "직원",
  "리뷰", "방문", "이용", "생각", "느낌", "정도", "때문", "경우", "부분", "다음",
  "오늘", "어제", "이번", "저희", "우리", "제가", "그거", "이거", "저거", "하나",
  "먹었", "갔었", "있었", "했었", "같아요", "있어요", "좋아요", "합니다", "습니다",
]);

export type Mood = "pos" | "neu" | "neg";

export interface SourceAnalysis {
  counts: { pos: number; neu: number; neg: number };
  total: number;
  keywords: { word: string; count: number }[];
}

export function moodOf(r: Pick<UnifiedReview, "rating" | "text">): Mood {
  // Star rating is the strongest signal when present.
  if (r.rating !== null && r.rating !== undefined) {
    if (r.rating >= 4) return "pos";
    if (r.rating <= 2) return "neg";
    return "neu";
  }
  const t = r.text || "";
  let s = 0;
  for (const w of POSITIVE) if (t.includes(w)) s++;
  for (const w of NEGATIVE) if (t.includes(w)) s--;
  return s > 0 ? "pos" : s < 0 ? "neg" : "neu";
}

const TRAIL =
  /(입니다|습니다|였어요|았어요|었어요|어요|아요|해요|네요|에요|이에요|더라고요|는데요|는데|는요|이고|하고|에서|으로|까지|부터|이랑|보다|처럼|만큼|같이|같은|한테|에게|이라|라고|이나|거나|든지)$/;

export function extractKeywords(
  texts: string[],
  topN = 8,
): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const raw of texts) {
    const tokens = raw.match(/[가-힣]{2,}/g) ?? [];
    const seen = new Set<string>();
    for (let tok of tokens) {
      tok = tok.replace(TRAIL, "");
      if (tok.length < 2 || STOP.has(tok)) continue;
      // count each keyword at most once per review (document frequency)
      if (seen.has(tok)) continue;
      seen.add(tok);
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

export function analyze(reviews: UnifiedReview[]): SourceAnalysis {
  const counts = { pos: 0, neu: 0, neg: 0 };
  for (const r of reviews) counts[moodOf(r)]++;
  return {
    counts,
    total: reviews.length,
    keywords: extractKeywords(reviews.map((r) => r.text)),
  };
}

export interface Insights {
  total: number;
  counts: { pos: number; neu: number; neg: number };
  posPct: number;
  neuPct: number;
  negPct: number;
  avgRating: number | null;
  keywords: { word: string; count: number }[];
  bySource: { platform: Platform; count: number }[];
  summary: string;
}

/** Combine all successful sources into one statistical insight. */
export function combineInsights(results: CollectResult[]): Insights | null {
  const ok = results.filter((r) => r.ok && r.reviews.length > 0);
  const all = ok.flatMap((r) => r.reviews);
  if (all.length === 0) return null;

  const counts = { pos: 0, neu: 0, neg: 0 };
  for (const r of all) counts[moodOf(r)]++;
  const total = all.length;
  const pct = (n: number) => Math.round((n / total) * 100);

  const rated = all.filter((r) => r.rating !== null) as (UnifiedReview & {
    rating: number;
  })[];
  const avgRating =
    rated.length > 0
      ? Math.round(
          (rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10,
        ) / 10
      : null;

  const keywords = extractKeywords(all.map((r) => r.text), 10);
  const bySource = ok.map((r) => ({
    platform: r.platform,
    count: r.reviews.length,
  }));

  const posPct = pct(counts.pos);
  const negPct = pct(counts.neg);
  const mood =
    posPct >= 60
      ? "대체로 긍정적"
      : negPct >= 40
        ? "부정적 의견이 적지 않은"
        : "긍정·부정이 혼재된";
  const kw = keywords.slice(0, 3).map((k) => `'${k.word}'`).join(", ");
  const summary =
    `총 ${total}개 리뷰를 분석한 결과 ${mood} 편입니다.` +
    (kw ? ` ${kw} 이(가) 자주 언급됩니다.` : "") +
    (avgRating !== null ? ` 평점 소스 평균은 ${avgRating}점입니다.` : "");

  return {
    total,
    counts,
    posPct,
    neuPct: pct(counts.neu),
    negPct,
    avgRating,
    keywords,
    bySource,
    summary,
  };
}
