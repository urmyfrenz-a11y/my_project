import type { AnalysisResult, FactorScore } from "./types";

/** 첫 구절만 추출 (· 또는 ( 앞) */
function head(detail: string): string {
  return detail.split(/·|\(/)[0].trim();
}

/**
 * 종합 분석 결과 → 핵심 인사이트 3가지 (강점 / 리스크 / 기회).
 * 팩터 점수와 상세를 규칙 기반으로 해석.
 */
export function buildInsights(r: AnalysisResult): { icon: string; text: string }[] {
  const byKey = (k: FactorScore["key"]) => r.factors.find((f) => f.key === k);
  const out: { icon: string; text: string }[] = [];

  // rent 는 역방향이라 강점/약점 후보에서 제외
  const ranked = r.factors.filter((f) => f.key !== "rent").sort((a, b) => b.score - a.score);
  const strong = ranked[0];
  const weak = ranked[ranked.length - 1];

  // 1) 강점
  if (strong) {
    out.push({
      icon: "💪",
      text: `강점 · ${strong.label} 최상위(${strong.score}점) — ${head(strong.detail)}`,
    });
  }

  // 2) 리스크
  const comp = byKey("competition");
  const rent = byKey("rent");
  if (comp && comp.source === "live" && comp.score < 60) {
    out.push({ icon: "⚠️", text: `리스크 · 개폐업 부담 — ${head(comp.detail)}` });
  } else if (weak && weak.score < 55) {
    out.push({ icon: "⚠️", text: `리스크 · ${weak.label}이(가) 약함(${weak.score}점)` });
  } else if (rent && rent.score < 55) {
    out.push({ icon: "⚠️", text: `리스크 · 임대료 부담이 상대적으로 큼` });
  } else {
    out.push({ icon: "⚖️", text: `안정 · 뚜렷한 약점이 적은 균형형 상권` });
  }

  // 3) 기회/특징
  const access = byKey("access");
  const floating = byKey("floating");
  const sales = byKey("sales");
  const demand = byKey("demand");
  if (access && access.score >= 85) {
    out.push({ icon: "🚈", text: `기회 · 역세권 입지 — ${head(access.detail)}` });
  } else if (floating && floating.score >= 85) {
    out.push({ icon: "🚶", text: `기회 · 유동인구 풍부 — ${head(floating.detail)}` });
  } else if (sales && sales.score >= 80) {
    out.push({ icon: "💰", text: `기회 · 매출 규모 큰 상권 — ${head(sales.detail)}` });
  } else if (demand && demand.score >= 75) {
    out.push({ icon: "🏠", text: `기회 · 배후 수요 탄탄 — ${head(demand.detail)}` });
  } else {
    out.push({
      icon: "📊",
      text: `종합 ${r.totalScore}점(${r.grade}등급) — ${
        r.totalScore >= 75 ? "우수 상권" : r.totalScore >= 60 ? "양호 상권" : "신중 검토 상권"
      }`,
    });
  }

  return out.slice(0, 3);
}
