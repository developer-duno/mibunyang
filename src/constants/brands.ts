export const BUILDER_ALIASES: Record<string, string> = {
  지에스건설: "GS건설",
  "GS건설(주)": "GS건설",
  "(주)GS건설": "GS건설",
  "현대건설(주)": "현대건설",
  "(주)현대건설": "현대건설",
  "(주)대우건설": "대우건설",
  "대우건설(주)": "대우건설",
  에이치디씨현대산업개발: "HDC현대산업개발",
  "HDC현대산업개발(주)": "HDC현대산업개발",
  디엘이앤씨: "DL이앤씨",
  "DL이앤씨(주)": "DL이앤씨",
  "포스코이앤씨(주)": "포스코이앤씨",
  "(주)포스코이앤씨": "포스코이앤씨",
  "삼성물산(주)": "삼성물산",
  삼성물산건설부문: "삼성물산",
  "롯데건설(주)": "롯데건설",
  "(주)롯데건설": "롯데건설",
  "대림산업(주)": "대림산업",
  "(주)대림산업": "대림산업",
  "한화건설(주)": "한화건설",
  "(주)한화건설": "한화건설",
  "호반건설(주)": "호반건설",
  "(주)호반건설": "호반건설",
  "SK에코플랜트(주)": "SK에코플랜트",
  "태영건설(주)": "태영건설",
  "(주)태영건설": "태영건설",
  "금호건설(주)": "금호건설",
  "(주)금호건설": "금호건설",
};

/**
 * 법인격 표기(`㈜`·`(주)`·`주식회사`)와 공백을 걷어낸 비교용 키.
 *
 * 별칭 표(`BUILDER_ALIASES`)는 손으로 채우는 목록이라 표기 변형을 다 못 따라간다 —
 * `"DL이앤씨(주)"` 는 있는데 `"디엘이앤씨 주식회사"` 는 없는 식이다. 정규화 후 대조하면
 * 그 변형들이 한 자리로 모인다(세션513 실측: 표 그대로는 202곳 매칭인데 정규화로 **68곳 추가 구제** —
 * "디엘이앤씨 주식회사"→DL이앤씨, "지에스건설(주)"→GS건설 등).
 */
const normalizeBuilderKey = (s: string): string => s.replace(/㈜|\(주\)|주식회사/g, "").replace(/\s+/g, "");

/**
 * 정규화 키 → canonical 이름 사전. `BRAND_TIER` 키 자신과 `BUILDER_ALIASES` 의 양변을 모두 담는다.
 * 먼저 넣은 항목이 이긴다(정규화 충돌 시 BRAND_TIER 의 정식 이름 우선).
 *
 * ⚠️ 첫 호출 때 만든다(모듈 로드 시점 아님) — `BRAND_TIER` 가 이 함수보다 **아래**에 선언돼 있어
 * 즉시 실행하면 TDZ(초기화 전 접근)로 죽는다. 사전은 한 번만 만들어 재사용한다.
 */
let normalizedBuilders: Record<string, string> | null = null;
function getNormalizedBuilders(): Record<string, string> {
  if (normalizedBuilders) return normalizedBuilders;
  const map: Record<string, string> = {};
  const put = (key: string, canonical: string): void => {
    const k = normalizeBuilderKey(key);
    if (k && !(k in map)) map[k] = canonical;
  };
  for (const canonical of Object.keys(BRAND_TIER)) put(canonical, canonical);
  for (const [alias, canonical] of Object.entries(BUILDER_ALIASES)) put(alias, canonical);
  normalizedBuilders = map;
  return map;
}

export function resolveBuilder(name?: string | null): string {
  if (!name) return "기타";
  const trimmed = name.trim();
  const alias = BUILDER_ALIASES[trimmed];
  if (alias) return alias;
  // 세션513: 별칭 표에 없어도 법인격·공백만 다른 것이면 같은 회사다.
  return getNormalizedBuilders()[normalizeBuilderKey(trimmed)] ?? trimmed;
}

export type BuilderTier = {
  tier: string;
  score: number;
  label: string;
  adj: number;
};

export const BRAND_TIER: Record<string, BuilderTier> = {
  현대건설: { tier: "1군Super", score: 20, label: "힐스테이트", adj: 1.05 },
  삼성물산: { tier: "1군Super", score: 20, label: "래미안", adj: 1.05 },
  GS건설: { tier: "1군Super", score: 20, label: "자이", adj: 1.05 },
  롯데건설: { tier: "1군", score: 15, label: "롯데캐슬", adj: 1.02 },
  대우건설: { tier: "1군", score: 15, label: "푸르지오", adj: 1.02 },
  HDC현대산업개발: { tier: "1군", score: 15, label: "아이파크", adj: 1.02 },
  DL이앤씨: { tier: "1군", score: 15, label: "e편한세상", adj: 1.02 },
  포스코이앤씨: { tier: "1군", score: 15, label: "더샵", adj: 1.02 },
  대림산업: { tier: "1군", score: 15, label: "위브", adj: 1.02 },
  한화건설: { tier: "2군", score: 10, label: "포레나", adj: 1.0 },
  호반건설: { tier: "2군", score: 10, label: "써밋", adj: 1.0 },
  SK에코플랜트: { tier: "2군", score: 10, label: "SK뷰", adj: 1.0 },
  제일건설: { tier: "3군", score: 5, label: "제일풍경채", adj: 0.98 },
  계룡건설: { tier: "3군", score: 5, label: "계룡리슈빌", adj: 0.98 },
  금호건설: { tier: "2군", score: 10, label: "어울림", adj: 1.0 },
  태영건설: { tier: "2군", score: 10, label: "데시앙", adj: 1.0 },
};

export const AGE_PREMIUM: readonly { min: number; max: number; coeff: number }[] = [
  { min: 0, max: 1, coeff: 1.03 },
  { min: 1, max: 3, coeff: 1.05 },
  { min: 3, max: 5, coeff: 1.1 },
  { min: 5, max: 10, coeff: 1.18 },
  { min: 10, max: 15, coeff: 1.3 },
  { min: 15, max: 20, coeff: 1.42 },
  { min: 20, max: 99, coeff: 1.55 },
];

/**
 * 미준공(분양 예정) 단지의 신축 프리미엄 계수 — 결함B 처방(세션528, ①안 채택).
 * `AGE_PREMIUM`(준공 후 나이 먹을수록 커지는 재건축 기대 계수)과는 별개 현상이다 — 저건
 * "이미 지어진 아파트가 오래될수록 비싸지는" 것이고, 이건 "아직 안 지어진 분양 단지가
 * 원래 그 동네 헌 아파트보다 비싸게 나오는" 것이다. 옛 코드는 미준공이면 1.0(중립)을 줘서
 * 이 프리미엄을 아예 무시했고, 그 결과 신축이라 당연히 비싼 것까지 "괴리(바가지)"로 깎았다.
 *
 * 실측 근거(세션527/528, 정적 JSON 1,730곳 중 미준공+버킷매칭 성공 892곳,
 * `price / matchAreaPrice(priceByArea)` 분포): p10 0.73 · p25 0.96 · **중앙 1.17** · p75 1.41 · p90 1.75.
 * 분양가가 더 비싼 단지 70.9%. 중앙값을 채택 — 극단값에 강건하고, 표본 하나가 fairPrice
 * 전체를 좌우하는 8곳이 섞여 있어도(scorePrice.ts CLAUDE.md 참조) 흔들리지 않는다.
 *
 * 반영 후 시뮬레이션(1,666곳): 괴리도 0점 비율 62.4%→45.6%, corr(면적,dev) −0.156 유지(결함A 해소분
 * 훼손 없음), 진짜 바가지 사례(써밋 리미티드 남천 −273%, 양산자이 파크팰리체 −442%)는 여전히 0점 —
 * 구조적으로 억울하게 깎이던 신축만 골라 재평가된다.
 */
export const PRESALE_PREMIUM_COEFF = 1.17;

export const LAYOUT_SCORE: Record<string, number> = {
  "4베이판상": 10,
  "4베이타워": 8,
  "3베이판상": 7,
  "3베이타워": 5,
  "2베이이하": 3,
};
/**
 * 혐오시설 감점표 — **키는 수집기가 만드는 카테고리 이름과 정확히 같아야 한다.**
 *
 * ⚠️ 세션510 실측에서 이 표가 수집기와 통째로 어긋나 있었다(운영 n=1,646):
 *   - 이름 어긋남: 표는 `고압송전탑`, 수집기는 `고압선` → **63곳이 감점을 못 받았다**
 *   - 죽은 키 3종(묘지·철도인접·유흥가): 수집기가 만들지 않는다(실측 0건) → 제거
 *   - 결과적으로 혐오시설 보유 1,119곳 중 **감점을 받는 건 56곳(5.0%)** 뿐이었고,
 *     나머지는 화면에 빨간 경고만 뜨고 점수는 그대로였다.
 *
 * 두 목록이 다시 어긋나지 않게 `scripts/collectors/noxious-penalty-sync.test.mjs` 가 CI 에서 대조한다.
 *
 * ## 수집되지만 일부러 감점 0인 것 (아래 `NOXIOUS_NO_PENALTY`)
 *
 * 감점 값은 "얼마나 나쁜가"를 재는 자료가 있어야 정할 수 있다. 그 자료가 없는 채로 숫자를 넣으면
 * 근거 없는 값이 박제돼 나중에 아무도 못 고친다. 그래서 **넣지 않고 이유를 적어 둔다.**
 */
export const NOXIOUS_PENALTY: Record<string, number> = {
  소각장: -18,
  고압선: -12, // 수집기 카테고리명(변전소 키워드). 옛 `고압송전탑` 표기가 63곳을 놓치고 있었다
  화장장: -10,
  교도소: -10,
};

/**
 * 수집기가 만들지만 **의도적으로 감점 0** 인 카테고리와 그 이유.
 *
 * 이 목록이 있어야 동기화 가드가 "빠뜨린 것"과 "일부러 뺀 것"을 구분할 수 있다.
 * 괄호 안은 2026-08-11 운영 실측(n=1,646) 보유 단지 수.
 */
export const NOXIOUS_NO_PENALTY: Record<string, string> = {
  공장: "1,097곳(67%)이 보유 — 너무 흔해서 감점해도 단지를 가르지 못한다(상대평가에서 무의미)",
  장례식장: "794곳(48%) 보유 — 같은 이유. 절반이 받는 감점은 변별력이 없다",
  하수처리장: "84곳(5.1%) — 희소해서 감점 가치가 있으나 악영향 크기를 잴 자료가 없다",
  폐수처리장: "81곳(4.9%) — 같음",
  축산시설: "45곳(2.7%) — 같음",
  매립지: "3곳(0.2%) — 같음",
};
