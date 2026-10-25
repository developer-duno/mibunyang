import type { Zone } from "@/constants/regulations";
import { calcMonthlyPayment } from "@/lib/loanRates";
import { DSR_LIMIT_BANK, LOAN_TERM_YEARS, ltvForPresale, stressAddFor, type PresaleLtv } from "@/constants/loanRules";

/**
 * 잔금 계획 계산 — 금융 탭 `FundingPlanner` 의 순수 계산(세션659). 금액은 전부 만원.
 * 입력은 화면 상태에서만 오고 어디에도 저장·전송하지 않는다.
 */

export type PaymentSplit = { contract: number; interim: number; balance: number };

export type FundingInput = {
  /** 선택한 평형의 분양가(만원) */
  price: number;
  zone: Zone;
  region?: string | null;
  gu?: string | null;
  /** 첫 입주자모집공고일 'YYYY-MM-DD' (경과규정 — 종전 값 안내용, 큰 숫자에는 안 쓴다) */
  firstDate?: string | null;
  /** 최근 입주자모집공고일 'YYYY-MM-DD' */
  latestDate?: string | null;
  /** 연소득(세전, 만원) — 빈칸·0 이하는 null 로 넘긴다 */
  income: number | null;
  /** 지금 가진 돈(만원) */
  cash: number | null;
  /** 기존 대출 월 상환(만원) */
  existingMonthly: number | null;
  split: PaymentSplit;
  /** 은행 아파트·분할상환 최저 금리(%) — 못 받았으면 null */
  bankRate: number | null;
};

export type FundingPlan = {
  stages: { contract: number; interim: number; balance: number };
  ltv: PresaleLtv;
  /** 소득 한도(만원) — 연소득이 없거나 금리가 없으면 null */
  incomeLimit: number | null;
  /** 소득 한도를 못 낸 이유 */
  incomeSkip: "no-income" | "no-rate" | null;
  /** 소득 한도에 쓴 스트레스 금리(%) = 은행 최저 금리 + 가산 */
  stressRate: number | null;
  stressAdd: number;
  /** 잔금 때 주담대 = min(지역 한도, 소득 한도) */
  loan: number;
  /** 월 상환액(만원, 반올림) — 금리가 없거나 대출 0 이면 null("0원/월" 금지) */
  monthly: number | null;
  /** 분양가 − 주담대 − 가진 돈 (음수면 남는 돈) */
  shortfall: number;
};

/** 0 이하·NaN·빈 값은 "입력 안 함"(소득 0 → 주담대 0 이 되지 않게) */
export function positiveOrNull(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

export function splitTotal(s: PaymentSplit): number {
  return s.contract + s.interim + s.balance;
}

/** 세 비율이 0~100 정수이고 합이 100 인가 */
export function isValidSplit(s: PaymentSplit): boolean {
  const parts = [s.contract, s.interim, s.balance];
  return parts.every((p) => Number.isFinite(p) && p >= 0 && p <= 100) && splitTotal(s) === 100;
}

/**
 * 연 상환 가능액으로 갚을 수 있는 최대 원금(만원, 내림) — 원리금균등. 금리 %·기간 년.
 * 월 상환 m, 월 금리 r, 횟수 n → 원금 = m × (1 − (1+r)^−n) / r.
 */
export function maxPrincipalForAnnualPayment(annualPayment: number, annualRatePct: number, years: number): number {
  if (!(annualPayment > 0) || !(annualRatePct > 0) || !(years > 0)) return 0;
  const m = annualPayment / 12;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  return Math.floor((m * (1 - Math.pow(1 + r, -n))) / r);
}

export type UnitRow = { house_manage_no: string; house_ty: string | null; top_amount: number | null };
export type UnitChip = { label: string; price: number };

/** 공고번호 비교 — 숫자 문자열 길이가 같다고 가정하지 않는다(길이 먼저, 같으면 문자열) */
export function compareNoticeNo(a: string, b: string): number {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * 청약홈 주택형 "059.9847A" → "59A" (전용㎡ 정수 + 뒤 글자). 숫자가 없으면 원문 그대로, 비면 null.
 */
export function unitLabel(houseTy: string | null | undefined): string | null {
  const s = String(houseTy ?? "").trim();
  if (!s) return null;
  const m = /^0*(\d+)(?:\.\d+)?\s*(.*)$/.exec(s);
  if (!m) return s;
  return `${Number(m[1])}${m[2].trim()}`;
}

/**
 * 평형 칩 — 최신 공고 한 벌만. 최신 공고 = 평형표 안에서 공고번호(앞 4자리 = 연도)가 가장 큰 공고(세션659 메인 결정).
 * 일정(`schedule`)이 고른 공고를 쓰지 않는 이유 — 무순위·잔여 공고는 일정 표에 없을 수 있는데, 미분양 손님에겐 지금 파는
 * 그 값이 기준이고 카드 대표 분양가도 그 공고에서 온다(ah-2022910270: 원공고 2022000456 vs 무순위 2024930047 → 2024930047).
 * 분양가 0·빈 행은 뺀다. 순서 = 전용면적(주택형 숫자) 오름차순.
 */
export function noticeUnitChips(units: readonly UnitRow[]): UnitChip[] {
  const priced = units.filter((u) => u.top_amount != null && Number.isFinite(u.top_amount) && u.top_amount > 0);
  if (priced.length === 0) return [];
  const pick = priced.map((u) => u.house_manage_no).reduce((a, b) => (compareNoticeNo(b, a) > 0 ? b : a));
  const area = (t: string | null) => {
    const n = parseFloat(String(t ?? ""));
    return Number.isFinite(n) ? n : Infinity;
  };
  const seen = new Set<string>();
  return priced
    .filter((u) => u.house_manage_no === pick)
    .sort((a, b) => area(a.house_ty) - area(b.house_ty) || String(a.house_ty).localeCompare(String(b.house_ty)))
    .flatMap((u) => {
      const label = unitLabel(u.house_ty) ?? "주택형";
      if (seen.has(label)) return [];
      seen.add(label);
      return [{ label, price: u.top_amount as number }];
    });
}

/** 대표 분양가와 가장 가까운 칩 번호(동점이면 앞 칩). 칩이 없으면 -1. */
export function closestChipIndex(chips: readonly UnitChip[], price: number | null | undefined): number {
  if (chips.length === 0) return -1;
  if (price == null || !(price > 0)) return 0;
  let best = 0;
  for (let i = 1; i < chips.length; i++) {
    if (Math.abs(chips[i].price - price) < Math.abs(chips[best].price - price)) best = i;
  }
  return best;
}

/** 계산 — 비율 합이 100 이 아니면 null(화면은 빨간 안내만 보이고 계산을 멈춘다) */
export function planFunding(input: FundingInput): FundingPlan | null {
  const { price, split } = input;
  if (!(price > 0) || !isValidSplit(split)) return null;

  const stages = {
    contract: Math.round((price * split.contract) / 100),
    interim: Math.round((price * split.interim) / 100),
    balance: Math.round((price * split.balance) / 100),
  };
  const ltv = ltvForPresale({
    price,
    zone: input.zone,
    region: input.region,
    gu: input.gu,
    firstDate: input.firstDate,
    latestDate: input.latestDate,
  });
  const stressAdd = stressAddFor(input.zone, input.region);
  const income = positiveOrNull(input.income);
  const rate = positiveOrNull(input.bankRate);

  let incomeLimit: number | null = null;
  let incomeSkip: FundingPlan["incomeSkip"] = null;
  let stressRate: number | null = null;
  if (income == null) incomeSkip = "no-income";
  else if (rate == null) incomeSkip = "no-rate";
  else {
    stressRate = Math.round((rate + stressAdd) * 100) / 100;
    const existingAnnual = (positiveOrNull(input.existingMonthly) ?? 0) * 12;
    const annual = Math.max(0, income * DSR_LIMIT_BANK - existingAnnual);
    incomeLimit = maxPrincipalForAnnualPayment(annual, stressRate, LOAN_TERM_YEARS);
  }

  // 큰 숫자는 늘 지금 규정(결정 18) — 종전 값(ltv.grandfathered)은 화면의 사실 안내 한 줄에만
  const region = ltv.current.amount;
  const loan = incomeLimit == null ? region : Math.min(region, incomeLimit);
  const pay = rate != null && loan > 0 ? Math.round(calcMonthlyPayment(loan, rate, LOAN_TERM_YEARS)) : 0;
  const monthly = pay > 0 ? pay : null;
  const shortfall = price - loan - (positiveOrNull(input.cash) ?? 0);

  return { stages, ltv, incomeLimit, incomeSkip, stressRate, stressAdd, loan, monthly, shortfall };
}
