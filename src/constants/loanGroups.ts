export type LoanGroup = {
  code: string;
  label: string;
};

/**
 * 금융권역 코드 → 탭 라벨. 코드 뜻은 금감원 금융상품통합비교공시(finlife) 오픈API 권역코드표:
 * 020000 은행 · 030200 여신전문 · 030300 저축은행 · 050000 보험.
 * (옛 라벨 030200="보험"·050000="기타"는 코드표와 달랐다 — 세션592)
 */
export const LOAN_GROUPS: readonly LoanGroup[] = [
  { code: "020000", label: "은행" },
  { code: "030300", label: "저축은행" },
  { code: "030200", label: "여신전문" },
  { code: "050000", label: "보험" },
];

export const DEFAULT_GROUP: string = "020000";
