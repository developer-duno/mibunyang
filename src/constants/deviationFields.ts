/**
 * 편차 스트립에 그릴 필드 정의 — 라벨·유불리 방향·양끝 한글 끝말·문장 조각을 한곳에 모은다.
 *
 * 왜 한곳인가 — 이 목록은 세 곳이 동시에 소비한다:
 *   ① 카드/팝업 렌더  ② `AptCard` 의 memo comparator(빠지면 값이 바뀌어도 화면이 안 바뀐다)
 *   ③ 회귀 테스트. 손으로 세 곳에 적으면 반드시 어긋난다(세션 430·461·479 에 세 번 당했다).
 *
 * **화면에 "중위값"·"백분위" 같은 전문어를 쓰지 않는다.** 오른쪽 값 슬롯은 숫자가 아니라
 * `12% 싸요` 같은 문장 조각이다. `−12%` 는 "왜 마이너스인데 막대는 오른쪽이지?"를 만들지만
 * `12% 싸요` 는 막대 방향과 어긋나지 않는다.
 */

/** 값 차이를 어떤 말로 읽을지 */
export type DeviationUnit =
  /** 비율 차이를 % 로: 분양가·관리비처럼 "얼마나 싼가" */
  | "percent"
  /** 이미 % 인 지표라 차이를 %p 로: 미분양률·전세가율·전용률 */
  | "percentPoint"
  /** 거리처럼 배수가 자연스러운 것: 2배 넘게 멀면 "N배 멀어요" */
  | "ratio";

export type DeviationFieldSpec = {
  /** `apt` 의 필드명 */
  field: string;
  /** 왼쪽 라벨 (한글 2~4자) */
  label: string;
  /** 어느 쪽이 유리한가 — 막대가 항상 오른쪽으로 길수록 유리하게 만드는 근거 */
  better: "low" | "high";
  /** 트랙 왼쪽 끝말 */
  lowWord: string;
  /** 트랙 오른쪽 끝말 */
  highWord: string;
  /** 값 슬롯 문장의 단위 표현 */
  unit: DeviationUnit;
  /** 유리할 때 맺음말 — `12% 싸요` 의 "싸요" */
  goodWord: string;
  /** 불리할 때 맺음말 — `8% 비싸요` 의 "비싸요" */
  badWord: string;
};

/**
 * 카드에 넣는 3줄. "싼가 / 안 팔리나 / 교통 되나" 에 하나씩 답한다.
 * 순서 고정 — 30장을 세로로 훑을 때 "세 번째 줄은 역세권"이 학습되게 한다.
 *
 * 선정 근거(2026-08-03 재실측): price 94.8% · unsoldRate 84.4% ·
 * subwayDist 82.9%(센티널 270건 제외). 전부 17개 시도에서 지역 기준값 산출 가능.
 */
export const CARD_DEVIATION_FIELDS: readonly DeviationFieldSpec[] = [
  {
    field: "price",
    label: "분양가",
    better: "low",
    lowWord: "싸다",
    highWord: "비싸다",
    unit: "percent",
    goodWord: "싸요",
    badWord: "비싸요",
  },
  {
    field: "unsoldRate",
    label: "미분양",
    better: "low",
    lowWord: "적다",
    highWord: "많다",
    unit: "percentPoint",
    goodWord: "적어요",
    badWord: "많아요",
  },
  {
    field: "subwayDist",
    label: "역세권",
    better: "low",
    lowWord: "가깝다",
    highWord: "멀다",
    unit: "ratio",
    goodWord: "가까워요",
    badWord: "멀어요",
  },
];

/**
 * 팝업 종합 탭에 넣는 8줄 = 카드 3줄 + 5줄. 카드와 **같은 컴포넌트**를 쓰고 트랙만 넓다
 * — 카드에서 배운 읽는 법이 팝업에서 그대로 통해야 하기 때문이다.
 *
 * ⚠️ `supplyRatio` 는 영구 제외 — 재실측 채움률 **0.0%**(1,581행 전부 null).
 *    `computeRegionalMedians` 가 계산은 하지만 쓸 수 있는 값이 없다.
 * ⚠️ `psr`(46.8%)·`pir` 는 성격이 다르다. `pir` 만 넣는다 — 둘 다 소득 대비 지표라
 *    나란히 두면 같은 말을 두 번 하는 셈이고, `psr` 은 채움률도 절반이다.
 */
export const OVERVIEW_DEVIATION_FIELDS: readonly DeviationFieldSpec[] = [
  ...CARD_DEVIATION_FIELDS,
  {
    field: "jeonseRate",
    label: "전세가율",
    better: "high",
    lowWord: "낮다",
    highWord: "높다",
    unit: "percentPoint",
    goodWord: "높아요",
    badWord: "낮아요",
  },
  {
    field: "pir",
    label: "소득부담",
    better: "low",
    lowWord: "가볍다",
    highWord: "무겁다",
    unit: "percent",
    goodWord: "가벼워요",
    badWord: "무거워요",
  },
  {
    field: "parkingRatio",
    label: "주차",
    better: "high",
    lowWord: "빠듯",
    highWord: "여유",
    unit: "percent",
    goodWord: "여유로워요",
    badWord: "빠듯해요",
  },
  {
    field: "avgMaintenanceCost",
    label: "관리비",
    better: "low",
    lowWord: "싸다",
    highWord: "비싸다",
    unit: "percent",
    goodWord: "싸요",
    badWord: "비싸요",
  },
  {
    field: "exclusiveRatio",
    label: "전용률",
    better: "high",
    lowWord: "좁다",
    highWord: "넓다",
    unit: "percentPoint",
    goodWord: "넓어요",
    badWord: "좁아요",
  },
];

/** 통계를 미리 계산해 둬야 하는 필드 전량 (= 팝업 8줄이 카드 3줄을 포함한다) */
export const DEVIATION_FIELD_NAMES: readonly string[] = OVERVIEW_DEVIATION_FIELDS.map((f) => f.field);

/** 필드명 → 스펙 */
export function deviationSpec(field: string): DeviationFieldSpec | undefined {
  return OVERVIEW_DEVIATION_FIELDS.find((f) => f.field === field);
}
