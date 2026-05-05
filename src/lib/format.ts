/** 만원 단위 → 억/만 혼합 표시 (예: 24675 → "2억 4675만") */
export const fmtPrice = (v: number | null | undefined): string => {
  if (v == null || v <= 0) return "-";
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만`;
  if (eok > 0) return `${eok}억`;
  return `${man.toLocaleString()}만`;
};

/** 이름 마스킹 (예: "홍길동" → "홍**", null → "") */
export const maskName = (name: string | null | undefined): string => {
  if (!name || typeof name !== "string") return "";
  const chars = Array.from(name);
  if (chars.length <= 1) return chars[0] || "";
  return chars[0] + "*".repeat(chars.length - 1);
};

/** 전화번호 마스킹 (예: "010-1234-5678" → "010-****-5678") */
export const maskPhone = (phone: string | null | undefined): string => {
  if (!phone || typeof phone !== "string") return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone;
  return digits.slice(0, 3) + "-****-" + digits.slice(-4);
};

/** YYYYMM → "YYYY년 MM월" (예: "202501" → "2025년 01월") */
export const fmtCompletion = (v: string | null | undefined): string => {
  if (!v || v.length < 6) return v || "-";
  return `${v.slice(0, 4)}년 ${v.slice(4, 6)}월`;
};

/** 분양가 범위: min~max (만원 → 억/만) */
export const fmtPriceRange = (min: number | null | undefined, max: number | null | undefined): string => {
  if (min == null && max == null) return "—";
  if (min != null && max != null && min === max) return fmtPrice(min);
  const lo = min != null ? fmtPrice(min) : "?";
  const hi = max != null ? fmtPrice(max) : "?";
  return `${lo} ~ ${hi}`;
};

interface ScheduleItem {
  scheduleName?: string;
  dateInfo?: string;
  schdl_info?: string;
}
const isScheduleItem = (x: unknown): x is ScheduleItem =>
  typeof x === "object" && x !== null;

/** presaleSchedule JSONB → 문자열 (배열/객체/문자열 모두 처리) */
export const fmtPresaleSchedule = (schedule: unknown): string => {
  if (!schedule) return "—";
  if (typeof schedule === "string") return schedule;
  if (Array.isArray(schedule)) {
    const items = (schedule as unknown[])
      .filter((s): s is ScheduleItem => isScheduleItem(s) && Boolean(s.scheduleName || s.dateInfo))
      .map(s => `${s.scheduleName ?? ""} ${s.dateInfo ?? ""}`.trim());
    return items.length > 0 ? items.join(", ") : "—";
  }
  if (isScheduleItem(schedule)) {
    if (schedule.scheduleName || schedule.dateInfo) {
      return `${schedule.scheduleName ?? ""} ${schedule.dateInfo ?? ""}`.trim();
    }
    if (schedule.schdl_info) {
      return typeof schedule.schdl_info === "string" ? schedule.schdl_info : "일정 있음";
    }
  }
  return "—";
};

/** 분양시기 포맷: "2026-03-01" → "2026.03.01" */
export const fmtRecruitDate = (v: unknown): string => {
  if (!v) return "—";
  if (!(typeof v === "string" || v instanceof Date)) return "—";
  const d = new Date(v as string | Date);
  if (isNaN(d.getTime())) return typeof v === "string" ? v : "—";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};
