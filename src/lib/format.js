/** 만원 단위 → 억/만 혼합 표시 (예: 24675 → "2억 4675만") */
export const fmtPrice = (v) => {
  if (v == null || v <= 0) return "-";
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만`;
  if (eok > 0) return `${eok}억`;
  return `${man.toLocaleString()}만`;
};

/** YYYYMM → "YYYY년 MM월" (예: "202501" → "2025년 01월") */
export const fmtCompletion = (v) => {
  if (!v || v.length < 6) return v || "-";
  return `${v.slice(0, 4)}년 ${v.slice(4, 6)}월`;
};
