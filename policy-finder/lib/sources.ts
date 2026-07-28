// 데이터 소스 레지스트리 (확정) — "스타트업·소상공인 지원사업"
//
// 이 목록으로 소스를 한정한다. type: "api"는 오픈API로 구현 완료,
// "crawl"은 공식 API가 없어 크롤러(별도 워커) 필요 → 순차 연동.

export type SourceStatus = "live" | "planned";
export type SourceKind = "api" | "crawl";

export interface SourceDef {
  key: string;
  name: string;
  site: string;
  kind: SourceKind;
  status: SourceStatus;
  note: string;
}

export const SOURCES: SourceDef[] = [
  {
    key: "kstartup",
    name: "K-Startup",
    site: "k-startup.go.kr",
    kind: "api",
    status: "live",
    note: "창업지원 중심, 기본 소스",
  },
  {
    key: "bizinfo",
    name: "기업마당",
    site: "bizinfo.go.kr",
    kind: "api",
    status: "live",
    note: "지자체·전 부처 통합 포털, 최대 커버리지. 모집중 공고 전 페이지",
  },
  {
    key: "bojo",
    name: "보조금24",
    site: "gov.kr",
    kind: "api",
    status: "live",
    note: "상시 수혜 제도 커버용(스타트업·기업 대상만 필터)",
  },
  {
    key: "nipa",
    name: "NIPA(과기정통부)",
    site: "nipa.kr",
    kind: "api",
    status: "planned",
    note: "AI/ICT/SW. NIPA 자체 API 없음 → 과기정통부_사업공고 API(data.go.kr 15074634)로 커버. 활용신청 필요(계정 키 공유)",
  },
  {
    key: "kocca",
    name: "KOCCA",
    site: "kocca.kr",
    kind: "api",
    status: "planned",
    note: "콘텐츠. 한국콘텐츠진흥원_지원사업공고 API(data.go.kr 15134251). 활용신청 필요(계정 키 공유)",
  },
  {
    key: "sbiz24",
    name: "소상공인24",
    site: "sbiz24.kr",
    kind: "crawl",
    status: "planned",
    note: "소진공 자체 공고 + 지자체·유관기관 통합조회. 공식 API 없음 → 크롤링(별도 워커)",
  },
];
