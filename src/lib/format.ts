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

/**
 * YYYYMM → "YYYY년 MM월" (예: "202501" → "2025년 01월").
 * 형식이 아니면 **원문 그대로** — 우리가 못 읽는 값을 읽은 척 꾸미지 않는다.
 *
 * 옛 코드는 `length < 6` 만 보고 앞 6자를 잘라 붙여서, 규약을 어긴 값이 손님 화면에
 * `"2030 미"` → `"2030년  미월"`, `"[1회]20"` → `"[1회]년 20월"` 처럼 깨진 문구로
 * 나갔다 (세션530). 수집 단계(`naver-presale.mjs parsePresaleCompletion`)가 1차로 막지만,
 * 이미 저장된 값과 다른 출처를 위해 표시 계층에도 방어선을 둔다.
 */
export const fmtCompletion = (v: string | null | undefined): string => {
  if (!v) return "-";
  const s = String(v);
  if (!/^\d{6}$/.test(s)) return s;
  return `${s.slice(0, 4)}년 ${s.slice(4, 6)}월`;
};

/**
 * 입주 시기 **표시값** — `completion`(YYYYMM)이 정본이고, 규약을 어겼거나 비었으면
 * 네이버 원문(`presaleMoveIn`)을 대신 보여준다.
 *
 * 왜 필요한가 (세션530): 옛 수집기가 `"2029 미정"` 을 6자에서 잘라 `"2029 미"` 로 저장한
 * 값이 44건 남아 있다. 원문에도 월이 없어 복구가 안 되는데, 잘린 값을 그대로 보이면
 * `"입주예정 2029 미"` 라 어색하다. 원문은 `"2029 미정"` 이라 사람이 읽을 수 있다.
 *
 * ⚠️ 그럼 DB 의 잘린 값을 비우면 되지 않나 — **안 된다.** `classifyMoveIn`(classify.ts:31)이
 *    `completion` 이 비면 입주 상태를 못 매기고, 그 결과가 `useDataPipeline` 의 "입주 시기"
 *    필터로 흘러가 그 44곳이 "입주예정" 목록에서 통째로 사라진다. 표시만 대체하는 이유다.
 */
export const fmtMoveIn = (completion: string | null | undefined, presaleMoveIn?: string | null): string => {
  if (completion && /^\d{6}$/.test(String(completion))) return fmtCompletion(completion);
  const raw = typeof presaleMoveIn === "string" ? presaleMoveIn.trim() : "";
  if (raw) return raw;
  const stored = typeof completion === "string" ? completion.trim() : "";
  return stored || "-";
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
