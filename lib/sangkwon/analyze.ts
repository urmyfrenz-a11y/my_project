import type { AnalysisResult, LatLng, FactorKey, FactorScore } from "./types";
import { assembleResult, buildDemoFactors } from "./scoring";
import {
  reverseRegion,
  countAttractionPois,
  nearestSubway,
  kakaoConfigured,
} from "./kakao";
import { storesInRadius, datagokrConfigured } from "./datagokr";

/** 반경 기준 팩터의 분석 반경(m) */
const RADIUS = 500;
/** 지하철 접근성 판단 반경(m) */
const SUBWAY_RADIUS = 800;

function clamp(n: number, lo = 20, hi = 99): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * 좌표 → 상권 분석 결과.
 *
 * 실데이터 연결 현황:
 *  - 점포현황(1)   : 소상공인 상가정보, 반경 500m 실데이터
 *  - 집객시설(9)   : 카카오 문화·관광·대형마트, 반경 500m 실데이터
 *  - 입지접근성(8) : 카카오 지하철역 최근접 거리, 실데이터
 *  - 지역명        : 카카오 행정동 실데이터
 *  - 나머지(2·3·4·5·6·7): 데모 (서울 열린데이터광장 행정동 연동 예정)
 */
export async function analyzeLocation(
  center: LatLng,
  addressHint: string
): Promise<AnalysisResult> {
  const factors = buildDemoFactors(center);
  const patch = (key: FactorKey, p: Partial<FactorScore>) => {
    const f = factors.find((x) => x.key === key);
    if (f) Object.assign(f, p);
  };

  let areaName = addressHint;

  const [region, poi, subway, stores] = await Promise.all([
    kakaoConfigured() ? reverseRegion(center) : Promise.resolve(null),
    kakaoConfigured() ? countAttractionPois(center, RADIUS) : Promise.resolve(null),
    kakaoConfigured() ? nearestSubway(center, SUBWAY_RADIUS) : Promise.resolve(null),
    datagokrConfigured() ? storesInRadius(center, RADIUS) : Promise.resolve(null),
  ]);

  if (region?.name) areaName = region.name;

  // 9. 집객시설 (문화·관광·대형마트)
  if (poi != null) {
    patch("poi", {
      source: "live",
      score: clamp(30 + Math.min(1, poi / 12) * 69),
      detail: `반경 ${RADIUS}m 내 문화·관광·대형마트 등 집객시설 ${poi.toLocaleString()}곳 (카카오 실데이터)`,
    });
  }

  // 8. 입지·접근성 (지하철)
  if (subway) {
    if (subway.count > 0 && subway.nearestDist != null) {
      const d = subway.nearestDist;
      patch("access", {
        source: "live",
        // 0m→95점, 800m→약 40점 선형
        score: clamp(95 - (d / SUBWAY_RADIUS) * 55),
        detail: `가장 가까운 지하철역 ${subway.nearestName ?? "역"} 약 ${d}m · 반경 ${SUBWAY_RADIUS}m 내 ${subway.count}개 (카카오 실데이터)`,
      });
    } else {
      patch("access", {
        source: "live",
        score: clamp(28),
        detail: `반경 ${SUBWAY_RADIUS}m 내 지하철역 없음 (카카오 실데이터)`,
      });
    }
  }

  // 1. 점포현황 (상가정보)
  if (stores) {
    const catText = stores.byCategory
      .map((c) => `${c.name} ${c.count}`)
      .join(", ");
    patch("stores", {
      source: "live",
      score: clamp(20 + Math.min(1, stores.total / 400) * 79),
      detail: `반경 ${RADIUS}m 내 점포 ${stores.total.toLocaleString()}개${
        catText ? ` · 상위 업종 ${catText}` : ""
      } (소상공인 상가정보 실데이터)`,
    });
  }

  const result = assembleResult(center, addressHint, areaName, factors);
  result.demo = factors.every((f) => f.source === "demo");
  return result;
}
