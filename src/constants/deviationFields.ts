import { fmtPrice } from "@/lib/format";

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
  /**
   * 스크린리더 문구에 붙일 단위 (`FIELD_META[].unit` 과 같은 값).
   *
   * ⚠️ `FIELD_META` 를 import 하지 않는 이유 — 그 파일(145엔트리)이 lazy `DetailModal`
   * 청크에 살고 있어서, 카드에서 부르면 **17KB 가 첫 화면 번들로 끌려온다**
   * (세션 487 실측: 초기 gzip 70.31 → 75.02 KB). aria 문구 하나 때문에 모든 방문자가
   * 그 비용을 치를 이유가 없어 단위만 여기 적어 둔다.
   */
  valueUnit: string;
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
    // ⚠️ 총 분양가(`price`)가 아니라 **평당가(`pp`)** 로 견준다.
    //
    // 총액으로 견주면 이 막대는 "싼가"가 아니라 **"작은가"** 를 보여준다.
    // 실측(2026-08-03, 1,581행): 면적 ↔ "싸다" 상관계수 −0.540.
    //   0~40㎡ 평균 86.1점 / 40~60 68.0 / 60~85 47.2 / 85~120 22.5 / 120~ 7.3
    // 실제로 서울 21.95㎡ 원룸이 "60% 싸요" 로 나왔는데, 평당가로는 **11% 비싼** 집이었다.
    // 손님이 "싸다"를 "가성비 좋다"로 읽으면 그대로 오도된다.
    //
    // 평당가로 바꾸면 상관계수 −0.024 로 편향이 사라지고, **채움률은 94.8% 로 동일**하다
    // (`pp` 는 `price` 와 같은 비율로 채워져 있다 — 직접 계산할 필요가 없고,
    //  직접 계산값과 저장값이 911행 전부 오차 5% 이내로 일치함을 확인했다).
    field: "pp",
    valueUnit: "만원",
    label: "평당가",
    better: "low",
    lowWord: "싸다",
    highWord: "비싸다",
    unit: "percent",
    goodWord: "싸요",
    badWord: "비싸요",
  },
  {
    field: "unsoldRate",
    valueUnit: "%",
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
    valueUnit: "m",
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
    valueUnit: "%",
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
    valueUnit: "배",
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
    valueUnit: "대/세대",
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
    valueUnit: "만원",
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
    valueUnit: "%",
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

/**
 * 스크린리더 문구에 넣을 값 표현. 분양가는 "3억 2,000만" 처럼 읽히게 기존 `fmtPrice` 를 쓴다
 * (그 함수는 이미 카드가 쓰고 있어 번들 추가 비용이 0 이다).
 */
export function formatDeviationValue(spec: DeviationFieldSpec, raw: unknown): string {
  if (raw == null) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  if (spec.valueUnit === "만원") return fmtPrice(n);
  return `${n}${spec.valueUnit}`;
}

/** 필드명 → 스펙 */
export function deviationSpec(field: string): DeviationFieldSpec | undefined {
  return OVERVIEW_DEVIATION_FIELDS.find((f) => f.field === field);
}
