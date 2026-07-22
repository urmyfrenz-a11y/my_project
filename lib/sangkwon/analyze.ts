import type { AnalysisResult, LatLng } from "./types";
import { assembleResult, buildDemoFactors } from "./scoring";
import { reverseRegion, countNearbyPois, kakaoConfigured } from "./kakao";

/**
 * 좌표 → 상권 분석 결과.
 *
 * 현재 동작:
 *  - 팩터 점수: 좌표 기반 데모 생성 (buildDemoFactors)
 *  - 카카오 REST 키가 있으면 지역명(reverseRegion)과 집객시설 POI(9번)를 실데이터로 보강
 *
 * 실데이터 연결(추후):
 *  - 서울 열린데이터광장(2·3·4·5·6번), 공공데이터포털(1·7·8번)을 각 팩터에 매핑.
 *    lib/sangkwon/seoul.ts, lib/sangkwon/datagokr.ts 에 클라이언트를 추가하고
 *    아래 factors 를 실 응답으로 교체하면 source 가 "live" 로 바뀐다.
 */
export async function analyzeLocation(
  center: LatLng,
  addressHint: string
): Promise<AnalysisResult> {
  const factors = buildDemoFactors(center);

  let areaName = addressHint;
  if (kakaoConfigured()) {
    const [region, poiCount] = await Promise.all([
      reverseRegion(center),
      countNearbyPois(center),
    ]);
    if (region) areaName = region;
    // 9번 집객시설을 카카오 실데이터로 보강
    if (poiCount != null) {
      const poi = factors.find((f) => f.key === "poi");
      if (poi) {
        poi.source = "live";
        poi.detail = `반경 400m 내 음식점 POI ${poiCount.toLocaleString()}곳 (카카오 실데이터)`;
        // total_count 를 0~99 로 스케일 (300곳 이상이면 상단)
        poi.score = Math.min(99, Math.max(20, Math.round((poiCount / 300) * 99)));
      }
    }
  }

  const result = assembleResult(center, addressHint, areaName, factors);
  return result;
}
