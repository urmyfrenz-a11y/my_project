// 카테고리 자동 분류기 (키워드 매칭)
//
// 10종 카테고리 중 하나를 판정한다. 어느 것도 매칭되지 않으면 '기타'.
// 운영 규칙(handoff): '기타'가 10건 이상 누적되면 분류체계 재검토 트리거.
//   → 적재 후 aggregate 로 '기타' 건수를 세어 경고를 남긴다(ingest 라우트 참고).
//
// 매칭 방식: 카테고리별 키워드 목록에 걸리는 개수로 점수화하고,
// 최고 점수 카테고리를 택한다. 동점이면 CATEGORY_RULES 의 앞선 항목이 우선.

export const CATEGORY_NAMES = [
  "정책자금",
  "경영안정지원",
  "판로개척",
  "창업지원",
  "재기·폐업지원",
  "보증지원",
  "컨설팅·교육",
  "시설·환경개선",
  "디지털전환·AI",
  "기타",
] as const;

export type CategoryName = (typeof CATEGORY_NAMES)[number];

export const FALLBACK_CATEGORY: CategoryName = "기타";

// 우선순위 순서대로 평가 (동점 시 앞 항목 우선)
const CATEGORY_RULES: { name: CategoryName; keywords: string[] }[] = [
  {
    name: "정책자금",
    keywords: [
      "융자", "이차보전", "정책자금", "자금지원", "대출", "저리",
      "이자지원", "운전자금", "시설자금", "경영자금", "금융지원",
    ],
  },
  {
    name: "보증지원",
    keywords: ["보증", "신용보증", "보증료", "보증서", "보증재단", "특례보증"],
  },
  {
    name: "재기·폐업지원",
    keywords: [
      "재기", "폐업", "재창업", "재도전", "희망리턴", "사업정리",
      "채무조정", "전직", "재취업",
    ],
  },
  {
    name: "창업지원",
    keywords: [
      "창업", "예비창업", "초기창업", "스타트업", "창업기업",
      "액셀러", "인큐베이", "창업보육", "창업패키지",
    ],
  },
  {
    name: "디지털전환·AI",
    keywords: [
      "디지털전환", "디지털", "스마트", "AI", "인공지능", "빅데이터",
      "키오스크", "온라인화", "스마트상점", "스마트공장", "DX",
      "메타버스", "플랫폼입점",
    ],
  },
  {
    name: "판로개척",
    keywords: [
      "판로", "마케팅", "수출", "해외진출", "온라인판매", "라이브커머스",
      "전시회", "박람회", "유통", "입점", "홍보", "브랜딩", "판촉", "매출",
      "온라인 플랫폼", "온라인플랫폼", "플랫폼 물류", "물류지원", "해외 온라인",
      "오픈마켓", "스마트스토어", "쇼핑몰", "커머스", "판매채널", "온라인 진출",
    ],
  },
  {
    name: "시설·환경개선",
    keywords: [
      "시설개선", "환경개선", "인테리어", "간판", "리모델링", "노후",
      "설비", "장비도입", "에너지효율", "점포환경", "위생",
    ],
  },
  {
    name: "컨설팅·교육",
    keywords: [
      "컨설팅", "교육", "멘토링", "코칭", "역량강화", "아카데미",
      "세미나", "설명회", "진단", "자문", "강좌", "연수",
    ],
  },
  {
    name: "경영안정지원",
    keywords: [
      "경영안정", "경영개선", "손실보상", "재난지원", "긴급지원",
      "고용유지", "인건비", "임대료", "공과금", "바우처", "경영지원",
    ],
  },
];

/** 제목/요약/분야 텍스트를 받아 카테고리명을 판정. 매칭 실패 시 '기타'. */
export function classifyCategory(...texts: (string | null | undefined)[]): CategoryName {
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  if (!haystack.trim()) return FALLBACK_CATEGORY;

  let best: CategoryName = FALLBACK_CATEGORY;
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (haystack.includes(kw.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = rule.name;
    }
  }
  return best;
}
