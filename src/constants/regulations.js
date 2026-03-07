// 규제지역 타입
export const ZONE_TYPE = {
  speculative: "투기과열지구",
  overheated: "조정대상지역",
  normal: "비규제지역",
};

// LTV 비율 (무주택자 기준, 9억 기준 차등)
export const LTV_RATES = {
  speculative: { under9: 0.40, over9: 0.20 },
  overheated:  { under9: 0.50, over9: 0.30 },
  normal:      { under9: 0.70, over9: 0.60 },
};

// region:gu → zone lookup (2023.01 전면 해제 이후 전역 normal)
// 재지정 시 예: ZONE_MAP["서울:강남구"] = "speculative"
export const ZONE_MAP = {};

export function getZone(region, gu) {
  // region이 "경기,서울,인천" 같은 복합값일 수 있음 → 첫 번째 값 사용
  const r = (region ?? "").split(",")[0].trim();
  const g = (gu ?? "").trim();
  return ZONE_MAP[`${r}:${g}`] || ZONE_MAP[r] || "normal";
}

// 9억 기준 LTV 대출한도 계산 (만원 단위)
export function calcLTV(price, zone) {
  const rates = LTV_RATES[zone];
  const threshold = 90000; // 9억
  if (price <= threshold) return Math.round(price * rates.under9);
  return Math.round(threshold * rates.under9 + (price - threshold) * rates.over9);
}
