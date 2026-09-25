import { formatDeviationValue, type DeviationFieldSpec } from "@/constants/deviationFields";
import {
  MIN_ANY_SAMPLE,
  MIN_REGION_SAMPLE,
  NATIONAL_KEY,
  percentileOf,
  usableValue,
  type FieldStat,
  type RegionalStats,
} from "@/scoring/regionalStats";

/**
 * 편차 한 줄의 계산 결과. **표시 전용 파생값**이다 —
 * 정렬·필터·추천·점수에 절대 쓰지 않는다.
 */
export type Deviation = {
  /**
   * `ok`      정상 막대
   * `sparse`  비교할 단지가 너무 적음 (G1)
   * `uniform` 그 지역이 다 같은 값이라 비교가 무의미 (G2)
   * `missing` 이 단지 값이 없음 / 센티널 (G3)
   * `estimated` 실측 없이 추정치만 있음 — 값만 보이고 막대 위치·비교 문구는 없다(세션576 D5-b)
   */
  state: "ok" | "sparse" | "uniform" | "missing" | "estimated";
  /** 0~100. **항상 클수록 유리** — 막대가 오른쪽으로 길수록 좋다는 규칙 하나로 통일된다. */
  fav: number | null;
  /** 값 슬롯에 그대로 넣는 문장 조각 */
  text: string;
  /** 색 결정용 */
  tone: "good" | "bad" | "neutral";
  /** 지역 표본이 모자라 전국 기준으로 그렸는가 → 회색 `전국` 배지 */
  nationalFallback: boolean;
};

/** 이 안이면 "평균 수준"으로 본다 (백분위 50 기준 ±3) */
const NEUTRAL_BAND = 3;
/** 거리처럼 배수가 자연스러운 지표에서 "N배" 표현으로 넘어가는 기준 */
const RATIO_WORD_THRESHOLD = 2;

function fmtNumber(n: number): string {
  const r = Math.round(n);
  return String(r);
}

/**
 * 값 슬롯 문장 조각 — `12% 싸요` / `3%p 많아요` / `2배 멀어요`.
 *
 * 숫자에 부호를 붙이지 않는 것이 핵심이다. 부호는 막대 방향과 충돌하고,
 * 부동산을 모르는 사람에게 "왜 마이너스인데 좋은 거지?"를 만든다.
 */
export function deviationText(spec: DeviationFieldSpec, value: number, median: number, good: boolean): string {
  const word = good ? spec.goodWord : spec.badWord;
  if (spec.unit === "percentPoint") {
    const diff = Math.abs(value - median);
    if (Math.round(diff * 10) === 0) return "평균 수준";
    const shown = diff < 1 ? diff.toFixed(1) : fmtNumber(diff);
    return `${shown}%p ${word}`;
  }
  if (spec.unit === "ratio") {
    if (median > 0 && value > median * RATIO_WORD_THRESHOLD) {
      return `${(value / median).toFixed(1).replace(/\.0$/, "")}배 ${word}`;
    }
    if (median <= 0) return word;
    const pct = Math.abs(1 - value / median) * 100;
    if (Math.round(pct) === 0) return "평균 수준";
    return `${fmtNumber(pct)}% ${word}`;
  }
  // percent
  if (median === 0) return word;
  const pct = Math.abs((value - median) / median) * 100;
  if (Math.round(pct) === 0) return "평균 수준";
  return `${fmtNumber(pct)}% ${word}`;
}

/** 그 지역 분포가 비교할 만한가 — 다 같은 값이면 막대가 거짓말이 된다 (G2) */
function isUniform(stat: FieldStat): boolean {
  return stat.mad === 0 || stat.distinct <= 2;
}

/**
 * 편차 한 줄을 계산한다 — 3중 게이트.
 *
 * G1 표본  시도 n≥20 이면 그 시도 기준. 8≤n<20 이면 전국 기준 + `전국` 배지.
 *          n<8 이면 아예 그리지 않는다.
 * G2 변별력 그 지역이 사실상 한 값이면(mad 0 또는 distinct ≤2) 그리지 않는다.
 *          **이게 구조적 방어선이다** — 지역 상수 필드(popGrowth·priceIndex·
 *          landCostRatio·netMigration·housingSupplyLevel, 재실측 결과 17개 시도
 *          전부 탈락)가 실수로 들어와도 필드명 하드코딩 없이 스스로 사라진다.
 * G3 본인값 이 단지 값이 null 이거나 센티널이면 회색 해칭 + `미수집`.
 */
export function computeDeviation(
  spec: DeviationFieldSpec,
  aptValue: unknown,
  region: string | null | undefined,
  stats: RegionalStats | null | undefined
): Deviation {
  const missing: Deviation = { state: "missing", fav: null, text: "미수집", tone: "neutral", nationalFallback: false };

  const value = usableValue(spec.field, aptValue);
  if (value == null) return missing;
  if (!stats) return missing;

  const regionStat = stats[region || "기타"]?.[spec.field];
  const nationalStat = stats[NATIONAL_KEY]?.[spec.field];

  let stat: FieldStat | undefined;
  let nationalFallback = false;
  if (regionStat && regionStat.n >= MIN_REGION_SAMPLE) {
    stat = regionStat;
  } else if (nationalStat && nationalStat.n >= MIN_ANY_SAMPLE) {
    stat = nationalStat;
    nationalFallback = true;
  }

  if (!stat || stat.n < MIN_ANY_SAMPLE) {
    return { state: "sparse", fav: null, text: "비교할 단지가 적어요", tone: "neutral", nationalFallback };
  }
  if (isUniform(stat)) {
    return { state: "uniform", fav: null, text: "이 지역은 다 같아요", tone: "neutral", nationalFallback };
  }

  const pct = percentileOf(stat, value);
  if (pct == null) return missing;

  // 낮을수록 좋은 지표는 뒤집어, 항상 "클수록 유리"로 만든다.
  const fav = spec.better === "low" ? 100 - pct : pct;

  if (Math.abs(fav - 50) <= NEUTRAL_BAND) {
    return { state: "ok", fav, text: "평균 수준", tone: "neutral", nationalFallback };
  }

  const good = fav > 50;
  return {
    state: "ok",
    fav,
    text: deviationText(spec, value, stat.median, good),
    tone: good ? "good" : "bad",
    nationalFallback,
  };
}

/**
 * 편차 한 줄에 넘길 값 — 이 단지 값이 비었고 spec 에 `fallback` 이 있으면 추정치를 쓴다.
 *
 * 추정 조건은 `== null` 하나다(점수 엔진 engine.ts `_noParking: apt.parkingRatio == null` 과 같다).
 * 실측값이 있으면 절대 덮지 않는다. 추정도 못 하면 원값을 그대로 돌려줘 `미수집` 이 된다.
 */
export function resolveDeviationInput(
  spec: DeviationFieldSpec,
  apt: Record<string, unknown>
): { value: unknown; estimated: boolean } {
  const own = apt[spec.field];
  if (own != null || !spec.fallback) return { value: own, estimated: false };
  const est = spec.fallback.estimate(...spec.fallback.from.map((f) => apt[f]));
  return est == null ? { value: own, estimated: false } : { value: est, estimated: true };
}

/**
 * 추정치 줄 — **지역 분포와 견주지 않는다**(세션576 D5-b, 사장님 결정).
 *
 * 검사관 실측: 주차 추정치와 실측값의 오차가 p10 −0.61 · p90 +0.69 인데 실측 분포의 사분위 폭은
 * 0.28 이다. 오차가 분포 폭보다 커서 막대 위치(백분위)와 "평균 수준"·"여유" 같은 비교 문구는 소음이다.
 * 그래서 값(`추정 1.13대/세대`)만 보이고 막대는 비교 불가 줄과 같은 회색으로 둔다(fav null).
 */
export function estimatedDeviation(spec: DeviationFieldSpec, value: unknown): Deviation {
  return {
    state: "estimated",
    fav: null,
    text: formatDeviationValue(spec, value, true),
    tone: "neutral",
    nationalFallback: false,
  };
}

/**
 * 편차 줄들이 읽는 입력이 두 단지에서 같은가 — memo 비교 함수용.
 *
 * 필드 값과 **추정에 쓰는 필드(`fallback.from`)** 를 같은 순회에서 본다. 필드 값만 보면
 * 추정 재료(주차대수 등)만 바뀐 단지가 옛 화면으로 남는다(스킬 silent-cache "키에 빠진 입력").
 */
export function deviationInputsEqual(
  fields: readonly DeviationFieldSpec[],
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  for (const f of fields) {
    if (a[f.field] !== b[f.field]) return false;
    for (const dep of f.fallback?.from ?? []) {
      if (a[dep] !== b[dep]) return false;
    }
  }
  return true;
}

/**
 * 스크린리더용 문장.
 *
 * ⚠️ **"점수" 라는 글자를 넣지 말 것** — `DetailModal` 테스트의
 * `getAllByRole("img", { name: /점수/ })` 와 충돌한다
 * (`CompletenessDonut.tsx:20` 주석에 박제된 함정).
 */
export function deviationAriaLabel(
  spec: DeviationFieldSpec,
  dev: Deviation,
  regionLabel: string,
  formattedValue: string
): string {
  const where = dev.nationalFallback ? "전국" : regionLabel;
  switch (dev.state) {
    case "missing":
      return `${spec.label} 자료가 아직 없습니다.`;
    case "sparse":
      return `${spec.label} ${formattedValue}. ${where}에 비교할 단지가 적어 견주지 못했습니다.`;
    case "uniform":
      return `${spec.label} ${formattedValue}. ${where} 단지들이 모두 같은 값이라 견줄 수 없습니다.`;
    case "estimated":
      return `${spec.label} ${formattedValue}. 추정치라 지역 단지들과 견주지 않았습니다.`;
    default:
      // 세션539 A-6: DeviationStrip.tsx 헤더와 같은 이유로 "아파트"라 단정하지 않는다 —
      // 대조군(regionalStats.ts:90)은 region 하나로만 묶여 오피스텔·재건축이 섞여 있다.
      // 헤더만 고치고 이 스크린리더 문장을 안 고치면 같은 위젯 안에서 눈에 보이는 글자와
      // 스크린리더가 듣는 말이 서로 다른 모집단을 말하게 된다.
      return `${spec.label} ${formattedValue}. ${where} 분양 단지 한가운데 값과 견주면 ${dev.text}.`;
  }
}
