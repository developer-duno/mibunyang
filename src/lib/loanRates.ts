/**
 * 주택담보대출 금리 계산 — 금융 탭의 "한 달에 갚을 돈" 블록과 은행 범위 막대가 같이 쓴다(세션593 D2·D3).
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

/** 아파트 담보 + 분할상환 상품인가 — 월 상환액·은행 막대 공통 거름 */
export function isApartmentAmortizing(r: RateLike): boolean {
  return r.mortgageType === "아파트" && String(r.repayType ?? "").startsWith("분할상환");
}

/** 0·NaN·빈 금리는 버린다 — "가장 싼 상품"으로 뽑히면 월 상환액이 0 이 된다(세션592 F3) */
function validRate(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

/**
 * 월 상환액에 쓸 금리 — **아파트 담보 + 분할상환** 상품 중 최저 `rateMin`.
 * 그런 상품이 없으면 null(블록을 그리지 않는다).
 */
export function pickMonthlyRate(rates: ReadonlyArray<RateLike>): number | null {
  let best: number | null = null;
  for (const r of rates) {
    if (!isApartmentAmortizing(r)) continue;
    const v = r.rateMin;
    if (!validRate(v)) continue;
    if (best == null || v < best) best = v;
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

export type BankRange = {
  /** 응답의 `bank` 그대로 — 묶기 키 */
  bank: string;
  /** 그 은행 아파트·분할상환 상품의 최저 `rateMin` */
  min: number;
  /** 그 은행 아파트·분할상환 상품의 최고 `rateMax` */
  max: number;
};

/** 은행 막대 줄 수 상한 */
export const BANK_RANGE_LIMIT = 5;

/**
 * 은행 범위 막대 재료 — 아파트·분할상환 상품만 은행별로 묶어 최저(`rateMin` 최솟값)~최고(`rateMax` 최댓값)
 * 한 줄씩, 최저 낮은 순으로 `limit` 줄. 0·NaN·빈 금리는 빼고, 최저·최고 중 하나라도 없는 은행은 줄을 만들지 않는다.
 * 평균은 만들지 않는다 — 응답엔 은행 평균이 없고 상품 평균은 은행 최저보다 낮기도 하다(부산 4.11 < 5.15).
 */
export function groupBankRanges(rates: ReadonlyArray<RateLike>, limit = BANK_RANGE_LIMIT): BankRange[] {
  const byBank = new Map<string, { min: number | null; max: number | null }>();
  for (const r of rates) {
    if (!isApartmentAmortizing(r)) continue;
    const bank = r.bank ?? "";
    if (!bank) continue;
    const cur = byBank.get(bank) ?? { min: null, max: null };
    if (validRate(r.rateMin) && (cur.min == null || r.rateMin < cur.min)) cur.min = r.rateMin;
    if (validRate(r.rateMax) && (cur.max == null || r.rateMax > cur.max)) cur.max = r.rateMax;
    byBank.set(bank, cur);
  }
  const out: BankRange[] = [];
  for (const [bank, v] of byBank) {
    if (v.min == null || v.max == null) continue;
    out.push({ bank, min: v.min, max: v.max });
  }
  out.sort((a, b) => a.min - b.min);
  return out.slice(0, limit);
}

/**
 * 은행 이름 표시용 — 법인 표기 "주식회사"(앞·뒤)와 남는 공백만 뗀다. 다른 글자는 그대로.
 * "농협은행주식회사" → "농협은행" · "주식회사 하나은행" → "하나은행". 떼고 나서 비면 원래 이름.
 */
export function displayBankName(bank: string): string {
  const s = bank
    .replace(/^\s*주식회사\s*/, "")
    .replace(/\s*주식회사\s*$/, "")
    .trim();
  return s || bank;
}

/** 공시월 "YYYYMM" → "N년 M월 공시". 형식이 아니면 null(그 글자만 뺀다). */
export function fmtDisclosureMonth(month: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})$/.exec(String(month ?? ""));
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}년 ${mm}월 공시`;
}
