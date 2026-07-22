import type { IndustryResult, LatLng } from "./types";
import { findIndustry } from "./industries";
import { countByKeyword, reverseRegion, kakaoConfigured } from "./kakao";
import { getIndustryDetail, seoulConfigured } from "./seoul";

const RADIUS = 500;

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
function eok(won: number): number {
  return Math.round(won / 1e8);
}

/** 특정 업종의 심층 분석 (서울 업종 실데이터 + 카카오 경쟁 밀도) */
export async function analyzeIndustry(
  center: LatLng,
  industryId: string
): Promise<IndustryResult | null> {
  const ind = findIndustry(industryId);
  if (!ind) return null;

  const region = kakaoConfigured() ? await reverseRegion(center) : null;
  const areaName = region?.name ?? "선택 위치";

  const [nearby, seoul] = await Promise.all([
    kakaoConfigured() ? countByKeyword(center, ind.keyword, RADIUS) : Promise.resolve(null),
    seoulConfigured() ? getIndustryDetail(region?.dong, region?.admCode, ind.seoul) : Promise.resolve(null),
  ]);

  const nearbyStores = nearby;
  // 경쟁강도: 반경 동종 점포 밀도 + 폐업률 반영
  const density = nearbyStores != null ? Math.min(1, nearbyStores / 40) : 0.5;
  const closePenalty = seoul ? Math.min(1, seoul.closeRate / 15) : 0;
  const competition = clamp(density * 80 + closePenalty * 20);
  // 기회지수: 매출 규모 ↑, 경쟁 ↓ 일수록 유리
  const salesBonus = seoul ? Math.min(1, Math.log10(Math.max(1, seoul.salesAmt)) / 11) : 0.4;
  const opportunity = clamp(45 + salesBonus * 45 - competition * 0.35);

  const source: "live" | "demo" = seoul || nearbyStores != null ? "live" : "demo";

  // ── 핵심 인사이트 3가지 ──
  const insights: { icon: string; text: string }[] = [];
  if (seoul && seoul.salesAmt > 0) {
    const who = [seoul.mainAge, seoul.mainGender].filter(Boolean).join(" ");
    insights.push({
      icon: "💰",
      text: `${areaName} ${ind.label} 분기 추정매출 약 ${eok(seoul.salesAmt).toLocaleString()}억원${
        who ? ` · 주 고객 ${who}` : ""
      }${seoul.peakTime ? ` · 피크 ${seoul.peakTime}` : ""}`,
    });
  }
  if (seoul && seoul.storeCount > 0) {
    const tone = seoul.closeRate > 8 ? "높은 편" : seoul.closeRate > 4 ? "보통" : "낮은 편";
    insights.push({
      icon: seoul.closeRate > 8 ? "⚠️" : "🔁",
      text: `동 내 ${ind.label} ${seoul.storeCount}개 · 개업률 ${seoul.openRate.toFixed(1)}% / 폐업률 ${seoul.closeRate.toFixed(1)}%(${tone})${
        seoul.franchiseRate > 0 ? ` · 프랜차이즈 ${seoul.franchiseRate.toFixed(0)}%` : ""
      }`,
    });
  }
  if (nearbyStores != null) {
    const tone = nearbyStores >= 30 ? "경쟁 치열" : nearbyStores >= 12 ? "경쟁 보통" : "경쟁 여유";
    insights.push({
      icon: nearbyStores >= 30 ? "🥊" : "🎯",
      text: `반경 ${RADIUS}m 내 동종 점포 ${nearbyStores.toLocaleString()}개 — ${tone}. 기회지수 ${opportunity}/100`,
    });
  }
  if (!insights.length) {
    insights.push({ icon: "ℹ️", text: "업종 실데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }

  return {
    industryId: ind.id,
    industryLabel: ind.label,
    areaName,
    nearbyStores,
    radius: RADIUS,
    competition,
    opportunity,
    seoul: seoul
      ? {
          quarter: seoul.quarter,
          salesAmt: seoul.salesAmt,
          salesCnt: seoul.salesCnt,
          peakTime: seoul.peakTime,
          mainGender: seoul.mainGender,
          mainAge: seoul.mainAge,
          storeCount: seoul.storeCount,
          openRate: seoul.openRate,
          closeRate: seoul.closeRate,
          franchiseRate: seoul.franchiseRate,
        }
      : null,
    source,
    insights: insights.slice(0, 3),
    note:
      "서울 상권분석(행정동)·카카오 실데이터 기반. 업종 매출·개폐업은 행정동 단위, 반경 점포수는 500m 기준입니다.",
  };
}
