/**
 * 주택담보대출 금리 계산 — 금융 탭의 "한 달에 갚을 돈" 블록과 금리 범위 줄(은행·2금융 탭)이 같이 쓴다(세션593 D2·D3 · 세션665).
 *
 * 왜 한 곳에 두나 — 두 블록이 같은 상품 거름(아파트 담보 + 분할상환)을 따로 적으면 반드시 어긋난다.
 * 월 상환액은 30년 원리금균등으로 계산하므로 만기일시상환·아파트외 상품의 금리를 쓰면 안 된다
 * (10/02 은행권 응답의 맨 위 3.7% 가 '아파트외·만기일시상환'이었다 — 세션592).
 */

type RateLike = {
  bank?: string | null;
  mortgageType?: string | null;
  repayType?: string | null;
  rateMin?: number | null;
  rateMax?: number | null;
};

/** 0·NaN·빈 금리는 버린다 — "가장 싼 상품"으로 뽑히면 월 상환액이 0 이 된다(세션592 F3) */
function validRate(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

/**
 * 월 상환액·금리 범위 줄이 **같이 쓰는 상품 하나 판정** — 이 함수 하나로만 거른다(세션593 후속 F1).
 * 아파트 담보 + 분할상환 **이고** `rateMin`·`rateMax` 둘 다 유효(0·NaN·빈 값 아님) **이고** `rateMin ≤ rateMax`.
 *
 * 왜 최고 금리까지 보나 — 최고 금리가 빈 상품을 월 상환액만 쓰고 범위 줄은 버리면, 큰 숫자 금리(4.1%)와
 * 범위 줄의 최저(4.20%)가 어긋난다. 최저만 있는 상품과 최고만 있는 상품이 묶이면 "5.00% ~ 4.00%"
 * 처럼 거꾸로 된 범위가 나온다. 두 값이 다 있고 순서가 맞는 상품만 쓰면 둘 다 생기지 않는다.
 */
export function isUsableMortgageRate(r: RateLike): r is RateLike & { rateMin: number; rateMax: number } {
  return (
    r.mortgageType === "아파트" &&
    String(r.repayType ?? "").startsWith("분할상환") &&
    validRate(r.rateMin) &&
    validRate(r.rateMax) &&
    r.rateMin <= r.rateMax
  );
}

/**
 * 월 상환액에 쓸 금리 — `isUsableMortgageRate` 를 지난 상품 중 최저 `rateMin`.
 * 은행 범위 줄의 최저와 늘 같다(같은 거름·같은 최솟값). 그런 상품이 없으면 null(블록을 그리지 않는다).
 */
export function pickMonthlyRate(rates: ReadonlyArray<RateLike>): number | null {
  let best: number | null = null;
  for (const r of rates) {
    if (!isUsableMortgageRate(r)) continue;
    if (best == null || r.rateMin < best) best = r.rateMin;
  }
  return best;
}

/** 원리금균등 월 상환액 (원금과 같은 단위 — 만원이면 만원) */
export function calcMonthlyPayment(principal: number, annualRate: number, years: number): number {
  if (!principal || !annualRate || !years) return 0;
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export type RateRange = {
  /** 쓸 상품의 최저 `rateMin` */
  min: number;
  /** 쓸 상품의 최고 `rateMax` */
  max: number;
  /** 서로 다른 `bank` 값 수(빈 이름 제외) — 화면엔 이 수만 쓰고 이름은 쓰지 않는다 */
  companyCount: number;
};

/**
 * 금리 범위 줄 재료 — `isUsableMortgageRate` 를 지난 상품 전체의 최저(`rateMin` 최솟값) ~ 최고(`rateMax` 최댓값)와
 * 공시한 회사 수. 그런 상품이 없으면 null(줄을 그리지 않는다).
 *
 * 왜 회사별로 묶지 않나(세션665 사장님 결정) — 미등록 상태에서 "금융사 이름 + 금리" 나 금리 순위는 금소법상
 * 중개·광고로 볼 위험이 있다. 그래서 화면엔 회사 이름·상품 이름·순위 없이 범위와 회사 수만 쓴다.
 * 정렬·자르기 없음 — 최솟값·최댓값·개수만 센다. 상품마다 최저 ≤ 최고이므로 범위도 늘 최저 ≤ 최고다.
 */
export function summarizeRateRange(rates: ReadonlyArray<RateLike>): RateRange | null {
  let min: number | null = null;
  let max: number | null = null;
  const companies = new Set<string>();
  for (const r of rates) {
    if (!isUsableMortgageRate(r)) continue;
    if (min == null || r.rateMin < min) min = r.rateMin;
    if (max == null || r.rateMax > max) max = r.rateMax;
    if (r.bank) companies.add(r.bank);
  }
  if (min == null || max == null) return null;
  return { min, max, companyCount: companies.size };
}

/** 공시월 "YYYYMM" → "N년 M월 공시". 형식이 아니면 null(그 글자만 뺀다). */
export function fmtDisclosureMonth(month: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})$/.exec(String(month ?? ""));
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}년 ${mm}월 공시`;
}
