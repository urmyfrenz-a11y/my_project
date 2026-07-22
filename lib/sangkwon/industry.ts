import type { IndustryResult, LatLng } from "./types";
import { findIndustry } from "./industries";
import { countByKeyword, reverseRegion, kakaoConfigured } from "./kakao";

const RADIUS = 500;

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 특정 업종의 반경 500m 경쟁·기회 분석 */
export async function analyzeIndustry(
  center: LatLng,
  industryId: string
): Promise<IndustryResult | null> {
  const ind = findIndustry(industryId);
  if (!ind) return null;

  const [region, count] = await Promise.all([
    kakaoConfigured() ? reverseRegion(center) : Promise.resolve(null),
    kakaoConfigured() ? countByKeyword(center, ind.keyword, RADIUS) : Promise.resolve(null),
  ]);
  const areaName = region?.name ?? "선택 위치";

  if (count == null) {
    return {
      industryId: ind.id,
      industryLabel: ind.label,
      areaName,
      storeCount: null,
      radius: RADIUS,
      competition: 50,
      opportunity: 50,
      source: "demo",
      note: "업종 점포 수 조회에 실패했습니다(데모 값). 잠시 후 다시 시도해 주세요.",
    };
  }

  // 동종 점포가 많을수록 경쟁 치열 (40개 이상이면 최상단)
  const competition = clamp((count / 40) * 100);
  // 경쟁이 낮을수록 진입 기회 ↑ (단순 역상관, 추후 매출·수요 반영)
  const opportunity = clamp(100 - competition * 0.6);

  return {
    industryId: ind.id,
    industryLabel: ind.label,
    areaName,
    storeCount: count,
    radius: RADIUS,
    competition,
    opportunity,
    source: "live",
    note: "반경 500m 내 동종 점포 수는 카카오 실데이터입니다. 업종별 추정매출·생존율은 서울 추정매출 API 연동 시 추가됩니다.",
  };
}
