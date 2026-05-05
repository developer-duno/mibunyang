export type LoanGroup = {
  code: string;
  label: string;
};

/** 금융권역 코드 → 탭 라벨 */
export const LOAN_GROUPS: readonly LoanGroup[] = [
  { code: "020000", label: "은행" },
  { code: "030300", label: "저축은행" },
  { code: "030200", label: "보험" },
  { code: "050000", label: "기타" },
];

export const DEFAULT_GROUP: string = "020000";
