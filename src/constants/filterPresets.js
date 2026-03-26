/**
 * 필터 프리셋 — 자주 쓰는 필터 조합 1-클릭 적용
 * applyPreset()에 전달되는 객체 형태 (미지정 필드는 기본값으로 초기화)
 */
export const FILTER_PRESETS = [
  {
    key: "newlywed",
    label: "신혼부부",
    desc: "5억 이하 · 60㎡~85㎡ · 혜택",
    values: { budgetMax: "5", areaMin: "60", areaMax: "85", benefitOnly: true, sortKey: "benefit" },
  },
  {
    key: "invest",
    label: "투자용",
    desc: "가격매력순 · 60점+ · 입주예정",
    values: { minScore: "60", moveInFilter: "입주예정", sortKey: "priceScore" },
  },
  {
    key: "safe",
    label: "안전우선",
    desc: "1군 시공사 · 70점+ · 안전순",
    values: { minScore: "70", builderTier: "1군", sortKey: "safe" },
  },
  {
    key: "budget3",
    label: "3억 이하",
    desc: "3억 이하 · 혜택순",
    values: { budgetMax: "3", sortKey: "benefit" },
  },
  {
    key: "large",
    label: "대단지",
    desc: "1000세대+ · 종합순",
    values: { unitsMin: "1000", sortKey: "total" },
  },
];
