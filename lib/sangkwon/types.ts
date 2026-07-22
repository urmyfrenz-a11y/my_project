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
  /** 서울 외 지역이면 true (이 경우 분석 결과 대신 안내) */
  notSeoul?: boolean;
  /** 선택 위치의 시/도 (예: "서울특별시", "경기도") */
  sido?: string;
}

export interface GeocodeResult {
  address: string;
  roadAddress?: string;
  placeName?: string;
  center: LatLng;
}

/** 업종 정의 */
export interface Industry {
  id: string;
  label: string;
  keyword: string; // 카카오 키워드 검색용(반경 점포수)
  seoul: string[]; // 서울 상권분석 업종명 부분일치 키워드
}

/** 업종별 서울 실데이터 상세 */
export interface IndustrySeoulDetail {
  quarter: string;
  /** 분기 추정매출(원) */
  salesAmt: number;
  /** 분기 매출 건수 */
  salesCnt: number;
  /** 주 매출 시간대 라벨 (예: "11~14시") */
  peakTime?: string;
  /** 주 고객 성별 ("남성"/"여성") */
  mainGender?: string;
  /** 주 고객 연령대 (예: "30대") */
  mainAge?: string;
  /** 동 내 해당 업종 점포 수 */
  storeCount: number;
  /** 개업률(%) */
  openRate: number;
  /** 폐업률(%) */
  closeRate: number;
  /** 프랜차이즈 비율(%) */
  franchiseRate: number;
}

/** 업종별 심층 분석 결과 */
export interface IndustryResult {
  industryId: string;
  industryLabel: string;
  areaName: string;
  /** 반경 내 동종 점포 수 (카카오, 실패 시 null) */
  nearbyStores: number | null;
  radius: number;
  /** 경쟁강도 0~100 */
  competition: number;
  /** 기회지수 0~100 */
  opportunity: number;
  /** 서울 업종 실데이터 (없으면 null) */
  seoul: IndustrySeoulDetail | null;
  source: "live" | "demo";
  /** 핵심 인사이트 3가지 */
  insights: { icon: string; text: string }[];
  note: string;
}
