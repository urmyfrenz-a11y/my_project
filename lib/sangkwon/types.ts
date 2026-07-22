// 서울 상권분석 — 공통 타입 정의

export interface LatLng {
  lat: number;
  lng: number;
}

/** 9개 분석 팩터의 코드 */
export type FactorKey =
  | "stores" // 1. 점포 현황
  | "floating" // 2. 유동인구
  | "demand" // 3. 배후 수요
  | "spending" // 4. 소비력
  | "sales" // 5. 매출 수준
  | "competition" // 6. 경쟁·동태
  | "rent" // 7. 임대료·권리금 (역방향: 낮을수록 좋음)
  | "access" // 8. 입지(접근성)
  | "poi"; // 9. 집객시설

export interface FactorScore {
  key: FactorKey;
  label: string; // 한글 표기
  score: number; // 0~100 정규화 점수
  weight: number; // 가중치(합 100)
  /** 사용자에게 보여줄 원자료 요약 (예: "유동인구 12,300명/일") */
  detail: string;
  /** live = 실제 오픈API, demo = 데모 데이터 */
  source: "live" | "demo";
}

export interface AnalysisResult {
  center: LatLng;
  address: string; // 대표 주소/장소명
  areaName: string; // 상권/행정동 명칭
  totalScore: number; // 0~100 종합 상권 점수
  grade: string; // S/A/B/C/D 등급
  factors: FactorScore[];
  /** 전체가 데모 데이터로 구성됐는지 여부 */
  demo: boolean;
  generatedAt: string;
}

export interface GeocodeResult {
  address: string;
  roadAddress?: string;
  placeName?: string;
  center: LatLng;
}
