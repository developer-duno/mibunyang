/** 만원 단위 → 억/만 혼합 표시 (예: 24675 → "2억 4675만") */
export const fmtPrice = (v: number | null | undefined): string => {
  if (v == null || v <= 0) return "-";
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만`;
  if (eok > 0) return `${eok}억`;
  return `${man.toLocaleString()}만`;
};

/**
 * 미분양률 표시 — 100% 초과는 데이터 신뢰 불가(전체 세대수에 청약홈 잔여공급분이
 * 들어가 분모가 작아진 경우)라 "100%+" 로 캡한다. 미분양은 본질적으로 전체 세대수를
 * 넘을 수 없으므로 2900% 같은 값은 표시 오류. collector(molit-units)가 진짜 세대수로
 * 보정하나 이름 매칭 실패분은 캡으로 방어 (세션 444).
 */
export const fmtUnsoldRate = (v: number | null | undefined): string => {
  if (v == null) return "-";
  if (v > 100) return "100%+";
  return `${v}%`;
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
const isScheduleItem = (x: unknown): x is ScheduleItem => typeof x === "object" && x !== null;

/** presaleSchedule JSONB → 문자열 (배열/객체/문자열 모두 처리) */
export const fmtPresaleSchedule = (schedule: unknown): string => {
  if (!schedule) return "—";
  if (typeof schedule === "string") return schedule;
  if (Array.isArray(schedule)) {
    const items = (schedule as unknown[])
      .filter((s): s is ScheduleItem => isScheduleItem(s) && Boolean(s.scheduleName || s.dateInfo))
      .map((s) => `${s.scheduleName ?? ""} ${s.dateInfo ?? ""}`.trim());
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

/** 청약 경쟁률 포맷: 1000:1↑ 정수+콤마(437,995:1), 미만 소수1자리(5.2:1), 음수 미달%(미달 30%), null 미수집 */
export const fmtCompetitionRate = (v: number | null | undefined): string => {
  if (v == null) return "미수집";
  if (v < 0) return `미달 ${(Math.abs(v) * 100).toFixed(0)}%`;
  const rate = v >= 1000 ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(1);
  return `${rate}:1`;
};
