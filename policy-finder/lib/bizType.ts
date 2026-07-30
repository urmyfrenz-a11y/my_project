// 기업 형태(대상) 분류기 — 소상공인 / 중소기업 / 창업(예비·스타트업)
//
// 지원사업은 대상 기업 형태가 섞여 있다(소상공인 전용, 중소기업 R&D, 예비창업 등).
// 사용자가 자기 형태를 고르면 맞는 것만 보이도록, 각 사업을 하나의 형태로 태깅한다.
//
// 업종(industry) 분류기와 같은 철학: 대부분은 형태 무관("공통")으로 두고,
// 명백히 특정 형태 전용인 사업만 태깅한다(보수적). 그래야 형태 미선택 시 공통 사업만
// 깔끔히 보이고, 형태를 고르면 그 형태 전용 사업이 더해진다.
//
// 우선순위: 소상공인 > 창업 > 중소기업 (겹칠 때 더 좁고 구체적인 대상 우선).
// 예) "소상공인 창업 지원" → 소상공인(가게를 여는 사람은 스타트업이 아니라 소상공인).

export const DEFAULT_BIZ_TYPE = "공통";

// UI 선택지(내 기업 형태)
export const BIZ_TYPES = ["소상공인", "중소기업", "창업"] as const;

export type BizType = (typeof BIZ_TYPES)[number] | typeof DEFAULT_BIZ_TYPE;

// 소상공인·자영업·소공인(제조 소상공인)·전통시장 상인 등
const SOSANG =
  /소상공인|자영업|소공인|점포|상인회|전통시장|골목상권|영세|백년가게|백년소공인|1인\s?소상공인|생계형|나들가게/;

// 예비창업·초기창업·스타트업 등 (범용 단어 '창업'만 있는 경우는 제외 — 소상공인 창업/창업교육 오탐 방지)
const CHANGUP =
  /예비창업|초기창업|창업초기|창업\s?3년|창업\s?7년|스타트업|창업기업|창업도약|창업패키지|1인\s?창업|재창업|딥테크|팁스|TIPS|사내벤처|글로벌\s?창업|창업사관학교|창업중심대학|창업\s?아이템/;

// 중소·중견·벤처 등 (창업 신호가 없을 때만 도달)
const SME =
  /중소기업|중견기업|벤처기업|이노비즈|메인비즈|글로벌\s?강소|강소기업|스케일업|중소·중견|중소중견/;

/**
 * 기업 형태 판정. 텍스트 신호(제목·요약·기관) 우선, 없으면 소스 기본값, 그래도 없으면 '공통'.
 * @param externalId 소스 구분용 external_id(예: "sbiz:123", "kstartup:456")
 */
export function classifyBizType(
  externalId: string | null | undefined,
  ...texts: (string | null | undefined)[]
): BizType {
  const hay = texts.filter(Boolean).join(" ");
  if (SOSANG.test(hay)) return "소상공인";
  if (CHANGUP.test(hay)) return "창업";
  if (SME.test(hay)) return "중소기업";

  // 텍스트 신호가 없을 때: 소스 성격을 기본값으로
  const id = externalId ?? "";
  if (id.startsWith("sbiz:")) return "소상공인"; // 소상공인24
  if (id.startsWith("kstartup:")) return "창업"; // K-Startup(창업진흥원)
  if (id.startsWith("smtech:")) return "중소기업"; // SMTECH(중기부 R&D) — 연동 예정

  return DEFAULT_BIZ_TYPE;
}
