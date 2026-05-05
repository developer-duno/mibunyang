import { C } from "@/theme";

export type SortOption = {
  key: string;
  pcLabel: string;
  mobileLabel: string;
  ac: string;
  bg: string;
  pas: string;
  expert: boolean;
};

/**
 * 정렬 옵션 단일 정의 — 소비자 5곳에서 참조
 *  1. useFilterSort.js      (VALID_SORT_KEYS — localStorage 검증)
 *  2. SearchFilterBar.jsx    (PC 버튼 + 모바일 select)
 *  3. ExpertSidebar.jsx      (전문가 정렬 5개 subset)
 *  4. App.jsx                (sorters 키 정합성)
 */
export const SORT_OPTIONS: SortOption[] = [
  { key: "total",      pcLabel: "종합",     mobileLabel: "종합순",     ac: C.indigo,   bg: C.indigoLight, pas: "#F0EEFF", expert: true },
  { key: "price",      pcLabel: "저가순",   mobileLabel: "저가순",     ac: C.amber,    bg: C.amberLight,  pas: "#FFFBEB", expert: true },
  { key: "priceScore", pcLabel: "가격매력", mobileLabel: "가격매력순", ac: C.green,    bg: C.greenLight,  pas: "#EDFCF2", expert: true },
  { key: "location",   pcLabel: "입지",     mobileLabel: "입지순",     ac: C.blue,     bg: C.blueLight,   pas: "#EEF3FF", expert: true },
  { key: "safe",       pcLabel: "안전",     mobileLabel: "안전순",     ac: C.red,      bg: C.redLight,    pas: "#FEF2F2", expert: true },
  { key: "benefit",    pcLabel: "혜택순",   mobileLabel: "혜택순",     ac: "#7C3AED",  bg: "#EDE9FE",     pas: "#F5F3FF", expert: false },
  { key: "newest",     pcLabel: "최신순",   mobileLabel: "최신순",     ac: C.slate600, bg: C.slate100,    pas: "#F8FAFC", expert: false },
];

/** localStorage / URL 파라미터 검증용 Set */
export const VALID_SORT_KEYS: ReadonlySet<string> = new Set(SORT_OPTIONS.map((o) => o.key));

/** 전문가 사이드바용 subset */
export const EXPERT_SORT_OPTIONS: SortOption[] = SORT_OPTIONS.filter((o) => o.expert);
