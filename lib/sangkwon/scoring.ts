import type { FactorKey, FactorScore, AnalysisResult, LatLng } from "./types";

/** 9개 팩터 메타 (가중치 합 = 100). rent 는 역방향(비용) 팩터. */
export const FACTOR_META: Record<
  FactorKey,
  { label: string; weight: number; inverse?: boolean }
> = {
  floating: { label: "유동인구", weight: 18 },
  sales: { label: "매출 수준", weight: 18 },
  demand: { label: "배후 수요", weight: 14 },
  spending: { label: "소비력", weight: 12 },
  access: { label: "입지·접근성", weight: 12 },
  competition: { label: "경쟁·동태", weight: 10 },
  stores: { label: "점포 현황", weight: 6 },
  poi: { label: "집객시설", weight: 6 },
  rent: { label: "임대료·권리금", weight: 4, inverse: true },
};

export const FACTOR_ORDER: FactorKey[] = [
  "floating",
  "sales",
  "demand",
  "spending",
  "access",
  "competition",
  "stores",
  "poi",
  "rent",
];

/** 가중 합산으로 0~100 종합 점수 산출 */
export function computeTotalScore(factors: FactorScore[]): number {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1;
  const weighted = factors.reduce((s, f) => s + f.score * f.weight, 0);
  return Math.round(weighted / totalWeight);
}

/** 점수 → 등급 */
export function gradeOf(score: number): string {
  if (score >= 85) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 45) return "C";
  return "D";
}

/** 좌표 기반 결정론적 의사난수 (0~1). 같은 위치 → 같은 값. */
function seededUnit(lat: number, lng: number, salt: number): number {
  const x = Math.sin(lat * 127.1 + lng * 311.7 + salt * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 데모용 팩터 점수 생성기.
 * 실제 오픈API 응답이 붙기 전까지, 좌표에 따라 안정적으로 달라지는 값을 만들어
 * UI/점수 로직을 완전히 동작시킨다. 키가 연결되면 이 함수 대신 실데이터를 사용.
 */
export function buildDemoFactors(center: LatLng): FactorScore[] {
  const { lat, lng } = center;
  // 서울 도심(중구 부근) 가까울수록 점수 가중 → 체감상 그럴듯하게
  const distFromCore = Math.hypot(lat - 37.5636, lng - 126.9976);
  const centrality = Math.max(0, 1 - distFromCore / 0.25); // 0~1

  return FACTOR_ORDER.map((key, i) => {
    const meta = FACTOR_META[key];
    const noise = seededUnit(lat, lng, i + 1); // 0~1
    // 중심성 60% + 노이즈 40% 혼합
    let base = centrality * 0.6 + noise * 0.4; // 0~1
    if (meta.inverse) base = 0.35 + noise * 0.5; // 임대료는 중심성과 별개로 변동
    const score = Math.round(35 + base * 60); // 35~95 범위
    return {
      key,
      label: meta.label,
      weight: meta.weight,
      score: Math.min(99, Math.max(20, score)),
      source: "demo" as const,
      detail: demoDetail(key, score, center),
    };
  });
}

function demoDetail(key: FactorKey, score: number, center: LatLng): string {
  const scale = (n: number) => Math.round(n * (score / 100));
  switch (key) {
    case "floating":
      return `일 평균 유동인구 약 ${scale(45000).toLocaleString()}명 (데모)`;
    case "sales":
      return `업종 평균 분기 추정매출 약 ${scale(9800).toLocaleString()}만원 (데모)`;
    case "demand":
      return `배후 상주+직장인구 약 ${scale(38000).toLocaleString()}명 (데모)`;
    case "spending":
      return `배후지 월평균 지출 상위 ${Math.max(5, 100 - score)}% 수준 (데모)`;
    case "access":
      return `반경 400m 내 지하철 출구 ${Math.max(0, Math.round(score / 20))}개 (데모)`;
    case "competition":
      return `최근 1년 생존율 약 ${Math.round(55 + score * 0.35)}% (데모)`;
    case "stores":
      return `반경 300m 내 동종 점포 약 ${Math.max(3, scale(120))}개 (데모)`;
    case "poi":
      return `집객시설(POI) 약 ${Math.max(2, scale(80))}곳 (데모)`;
    case "rent":
      return `1층 임대료 지수 ${Math.round(60 + (100 - score) * 0.6)} / 공실률 ${Math.max(2, Math.round((100 - score) / 6))}% (데모)`;
    default:
      return "데모 데이터";
  }
}

/** 팩터 배열 → 최종 분석 결과 조립 */
export function assembleResult(
  center: LatLng,
  address: string,
  areaName: string,
  factors: FactorScore[]
): AnalysisResult {
  const totalScore = computeTotalScore(factors);
  return {
    center,
    address,
    areaName,
    totalScore,
    grade: gradeOf(totalScore),
    factors,
    demo: factors.every((f) => f.source === "demo"),
    // 호출 측에서 실제 시각을 주입 (서버에서 stamp)
    generatedAt: "",
  };
}
