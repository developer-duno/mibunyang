/** 만원 단위 → 억/만 혼합 표시 (예: 24675 → "2억 4675만") */
export const fmtPrice = (v) => {
  if (v == null || v <= 0) return "-";
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만`;
  if (eok > 0) return `${eok}억`;
  return `${man.toLocaleString()}만`;
};

/** 이름 마스킹 (예: "홍길동" → "홍**", null → "") */
export const maskName = (name) => {
  if (!name || typeof name !== "string") return "";
  const chars = Array.from(name);
  if (chars.length <= 1) return chars[0] || "";
  return chars[0] + "*".repeat(chars.length - 1);
};

/** 전화번호 마스킹 (예: "010-1234-5678" → "010-****-5678") */
export const maskPhone = (phone) => {
  if (!phone || typeof phone !== "string") return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone;
  return digits.slice(0, 3) + "-****-" + digits.slice(-4);
};

/** YYYYMM → "YYYY년 MM월" (예: "202501" → "2025년 01월") */
export const fmtCompletion = (v) => {
  if (!v || v.length < 6) return v || "-";
  return `${v.slice(0, 4)}년 ${v.slice(4, 6)}월`;
};
