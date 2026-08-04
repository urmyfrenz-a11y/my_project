// 에버그린(상시) 사업 — 공고 피드엔 안 잡히지만 소상공인이 늘 이용하는 상시 제도.
// 노란우산공제처럼 마감 없이 상시 가입/신청하는 것들을 수기로 큐레이션한다.
// (지역·형태·업종은 route에서 재분류되지 않도록 seed 값을 그대로 쓴다 —
//  다만 industry/biz_type은 route의 분류기가 덮어쓰므로, 제목에 신호가 들어가게 둔다.)

import { NormalizedProgram } from "./bizinfo";
import { CategoryName } from "./categories";

interface EvergreenSeed {
  id: string;
  title: string;
  institution: string;
  category: CategoryName;
  summary: string;
  source_url: string;
}

const SEEDS: EvergreenSeed[] = [
  {
    id: "yellow-umbrella",
    // 제목에 '소상공인'이 들어가 형태 분류가 소상공인으로 잡히게 한다.
    title: "소기업·소상공인 공제(노란우산) 상시 가입",
    institution: "중소기업중앙회(노란우산)",
    category: "경영안정지원",
    summary:
      "소기업·소상공인 대표의 폐업·노령·사망 등에 대비하는 공제제도. 납입부금은 연 최대 500만원 소득공제, 공제금은 압류로부터 보호되며 무료 상해보험도 제공. 마감 없이 상시 가입 가능.",
    source_url: "https://www.8899.or.kr",
  },
];

/** 상시 사업 목록(전국·상시모집). 마감 없음(is_ongoing=true). */
export function fetchEvergreenPrograms(): NormalizedProgram[] {
  return SEEDS.map((s) => ({
    external_id: `evergreen:${s.id}`,
    title: s.title,
    institution_name: s.institution,
    category_name: s.category,
    region_scope: "national" as const,
    province: null,
    region_district: null,
    summary: s.summary,
    support_amount: null,
    apply_start: null,
    apply_end: null,
    is_ongoing: true,
    source_url: s.source_url,
  }));
}
