import type { AnalysisResult, LatLng, FactorKey, FactorScore } from "./types";
import { assembleResult, buildDemoFactors } from "./scoring";
import {
  reverseRegion,
  countAttractionPois,
  nearestSubway,
  kakaoConfigured,
} from "./kakao";
import { storesInRadius, datagokrConfigured } from "./datagokr";
import {
  getLivingPopulation,
  getResidentPopulation,
  getDongSales,
  getDongStoreDynamics,
  getConsumption,
  seoulConfigured,
} from "./seoul";
import { getRentVacancy, roneConfigured } from "./rone";

/** 반경 기준 팩터의 분석 반경(m) */
export const RADIUS = 500;
/** 지하철 접근성 판단 반경(m) */
const SUBWAY_RADIUS = 800;

function clamp(n: number, lo = 20, hi = 99): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 느린 호출이 전체 분석을 막지 않도록 타임아웃 래핑 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function notSeoulResult(center: LatLng, areaName: string, sido?: string): AnalysisResult {
  return {
    center,
    address: areaName,
    areaName,
    totalScore: 0,
    grade: "-",
    factors: [],
    demo: false,
    generatedAt: "",
    notSeoul: true,
    sido,
  };
}

/**
 * 좌표 → 상권 분석 결과.
 *
 * 실데이터:
 *  - 점포현황(1)   : 소상공인 상가정보 (반경 500m)
 *  - 집객시설(9)   : 카카오 문화·관광·대형마트 (반경 500m)
 *  - 입지접근성(8) : 카카오 지하철역 최근접 거리
 *  - 유동인구(2)   : 서울 생활인구(행정동)
 *  - 배후수요(3)   : 서울 상주인구·가구·아파트세대(행정동)
 *  - 매출(5)       : 서울 추정매출(행정동 업종 합계)
 *  - 소비력(4)     : 서울 소득소비(행정동)
 *  - 경쟁(6)       : 서울 점포 개폐업률(행정동)
 *  - 임대료(7)     : 한국부동산원 R-ONE 상업용부동산 임대동향(서울 중대형상가)
 */
export async function analyzeLocation(
  center: LatLng,
  addressHint: string
): Promise<AnalysisResult> {
  const region = kakaoConfigured() ? await reverseRegion(center) : null;
  if (region?.sido && !region.sido.includes("서울")) {
    return notSeoulResult(center, region.name || addressHint, region.sido);
  }
  const areaName = region?.name || addressHint;
  const dong = region?.dong;
  const admCode = region?.admCode;

  const factors = buildDemoFactors(center);
  const patch = (key: FactorKey, p: Partial<FactorScore>) => {
    const f = factors.find((x) => x.key === key);
    if (f) Object.assign(f, p);
  };

  const [poi, subway, stores, living, resident, sales, dynamics, cnsmp, rent] = await Promise.all([
    kakaoConfigured() ? countAttractionPois(center, RADIUS) : Promise.resolve(null),
    kakaoConfigured() ? nearestSubway(center, SUBWAY_RADIUS) : Promise.resolve(null),
    datagokrConfigured() ? storesInRadius(center, RADIUS) : Promise.resolve(null),
    seoulConfigured() ? withTimeout(getLivingPopulation(dong, admCode), 6000) : Promise.resolve(null),
    seoulConfigured() ? withTimeout(getResidentPopulation(dong, admCode), 6000) : Promise.resolve(null),
    seoulConfigured() ? withTimeout(getDongSales(dong, admCode), 9000) : Promise.resolve(null),
    seoulConfigured() ? withTimeout(getDongStoreDynamics(dong, admCode), 12000) : Promise.resolve(null),
    seoulConfigured() ? withTimeout(getConsumption(dong, admCode), 8000) : Promise.resolve(null),
    roneConfigured() ? withTimeout(getRentVacancy(), 12000) : Promise.resolve(null),
  ]);

  // 9. 집객시설
  if (poi != null) {
    patch("poi", {
      source: "live",
      score: clamp(30 + Math.min(1, poi / 12) * 69),
      detail: `반경 ${RADIUS}m 내 문화·관광·대형마트 등 집객시설 ${poi.toLocaleString()}곳 (카카오 실데이터)`,
    });
  }

  // 8. 입지·접근성
  if (subway) {
    if (subway.count > 0 && subway.nearestDist != null) {
      const d = subway.nearestDist;
      patch("access", {
        source: "live",
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

  // 1. 점포현황
  if (stores) {
    const catText = stores.byCategory.map((c) => `${c.name} ${c.count}`).join(", ");
    patch("stores", {
      source: "live",
      score: clamp(20 + Math.min(1, stores.total / 400) * 79),
      detail: `반경 ${RADIUS}m 내 점포 ${stores.total.toLocaleString()}개${
        catText ? ` · 상위 업종 ${catText}` : ""
      } (소상공인 상가정보 실데이터)`,
    });
  }

  // 2. 유동인구 (서울 생활인구)
  if (living) {
    const v = Number(living.TOT_FLPOP_CO) || 0;
    patch("floating", {
      source: "live",
      score: clamp(20 + Math.min(1, v / 6_000_000) * 79),
      detail: `${living.ADSTRD_CD_NM} 분기 생활인구 약 ${v.toLocaleString()}명 (${living.STDR_YYQU_CD}, 서울 실데이터)`,
    });
  }

  // 3. 배후수요 (서울 상주인구·가구)
  if (resident) {
    const rep = Number(resident.TOT_REPOP_CO) || 0;
    const hh = Number(resident.TOT_HSHLD_CO) || 0;
    const apt = Number(resident.APT_HSHLD_CO) || 0;
    patch("demand", {
      source: "live",
      score: clamp(20 + Math.min(1, rep / 45000) * 79),
      detail: `${resident.ADSTRD_CD_NM} 상주인구 ${rep.toLocaleString()}명 · 총가구 ${hh.toLocaleString()}${
        apt ? ` (아파트 ${apt.toLocaleString()}세대)` : ""
      } (${resident.STDR_YYQU_CD}, 서울 실데이터)`,
    });
  }

  // 5. 매출 (서울 추정매출 동 합계)
  if (sales && sales.total > 0) {
    const eok = sales.total / 1e8; // 억원
    const topText = sales.top.map((t) => t.name).slice(0, 2).join(", ");
    patch("sales", {
      source: "live",
      score: clamp(20 + Math.min(1, (Math.log10(sales.total) - 8.5) / 2.5) * 79),
      detail: `${sales.name} 분기 추정매출 약 ${Math.round(eok).toLocaleString()}억원${
        topText ? ` · 상위 업종 ${topText}` : ""
      } (${sales.quarter}, 서울 실데이터)`,
    });
  }

  // 6. 경쟁·동태 (서울 점포 개폐업률)
  if (dynamics && dynamics.totalStores > 0) {
    patch("competition", {
      source: "live",
      score: clamp(95 - dynamics.avgClsbiz * 3),
      detail: `${dynamics.name} 개업률 ${dynamics.avgOpbiz.toFixed(1)}% / 폐업률 ${dynamics.avgClsbiz.toFixed(1)}% · 점포 ${dynamics.totalStores.toLocaleString()}개 (${dynamics.quarter}, 서울 실데이터)`,
    });
  }

  // 4. 소비력 (서울 소비지출)
  if (cnsmp && cnsmp.total > 0) {
    patch("spending", {
      source: "live",
      score: clamp(20 + Math.min(1, (Math.log10(cnsmp.total) - 8.7) / 2) * 79),
      detail: `${cnsmp.name} 분기 소비지출 약 ${Math.round(cnsmp.total / 1e8).toLocaleString()}억원${
        cnsmp.topCategory ? ` · 최다 지출 ${cnsmp.topCategory}` : ""
      } (${cnsmp.quarter}, 서울 실데이터)`,
    });
  }

  // 7. 임대료·권리금 (R-ONE 상업용부동산 임대동향 — 서울 중대형상가, 역방향: 낮을수록 좋음)
  if (rent && (rent.rent != null || rent.vacancy != null)) {
    const parts: string[] = [];
    if (rent.rent != null) parts.push(`임대료 ${rent.rent.toLocaleString()}${rent.rentUnit || "원/㎡"}`);
    if (rent.vacancy != null) parts.push(`공실률 ${rent.vacancy}%`);
    // 임대료(원/㎡)가 낮을수록 유리 → 역방향 점수. 서울 중대형상가 대략 3만~10만원/㎡ 밴드.
    let score = 55;
    if (rent.rentWonPerM2 != null) {
      score = 90 - ((rent.rentWonPerM2 - 30000) / 70000) * 60; // 3만→90, 10만→30
    }
    // 공실률이 높으면 상권 활력 측면 감점(소폭)
    if (rent.vacancy != null) score -= Math.min(15, rent.vacancy * 0.8);
    patch("rent", {
      source: "live",
      score: clamp(score),
      detail: `${rent.region} 중대형상가 ${parts.join(" · ")} (${rent.quarter}, 한국부동산원 R-ONE 실데이터)`,
    });
  }

  const result = assembleResult(center, addressHint, areaName, factors);
  result.demo = factors.every((f) => f.source === "demo");
  result.sido = region?.sido;
  return result;
}
