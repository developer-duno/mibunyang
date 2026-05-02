// 구글 캘린더 일정 추가 URL 빌더 (spec § 5-4 + § 6-4)
// 분양예정 단지의 청약 일정을 종일 일정으로 등록.
// 청약 시작일 (recruit_date) ~ 청약 마감일 (presaleSchedule.dateInfo) 또는 시작일+3.

const BASE = "https://www.google.com/calendar/render";

// "YYYY-MM-DD" / "YYYY.MM.DD" / Date 모두 받아 ISO YYYY-MM-DD 로 정규화
export function parseDateLoose(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return formatISO(v);
  }
  if (typeof v !== "string") return null;
  const normalized = v.trim().replace(/\./g, "-");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;
  return formatISO(d);
}

function formatISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 구글 캘린더 dates 파라미터용 YYYYMMDD
function toCompact(iso) {
  return iso.replace(/-/g, "");
}

export function addDaysISO(iso, days) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return formatISO(d);
}

/**
 * 분양예정 단지의 청약 일정을 구글 캘린더 URL 로 빌드
 *
 * @param {object} apt - { name, region, gu, presaleRecruitDate, presaleSchedule, presaleHousingType, presaleInquiry }
 * @param {object} [opts]
 * @param {Date|string} [opts.endDate] - 명시 종료일 (없으면 schedule.dateInfo 또는 시작+3)
 * @returns {string|null} URL 또는 필수 데이터 부재 시 null
 */
export function buildGoogleCalendarUrl(apt, opts = {}) {
  if (!apt || typeof apt !== "object") return null;

  const startISO = parseDateLoose(apt.presaleRecruitDate);
  if (!startISO) return null;

  const endISO =
    parseDateLoose(opts.endDate) ||
    parseDateLoose(apt.presaleSchedule?.dateInfo) ||
    addDaysISO(startISO, 3);

  if (!endISO) return null;

  const text = `${apt.name ?? "분양 단지"} 청약`;
  const detailsLines = [
    apt.region && apt.gu ? `${apt.region} ${apt.gu}` : (apt.region ?? null),
    apt.presaleHousingType ? `유형: ${apt.presaleHousingType}` : null,
    apt.presaleInquiry ? `문의: ${apt.presaleInquiry}` : null,
    "출처: 미분양 비교 엔진",
  ].filter(Boolean);
  const details = detailsLines.join("\n");

  // 구글 캘린더 종일 일정: dates=YYYYMMDD/YYYYMMDD
  // end 가 start 와 같은 날이면 다음날을 끝으로 (구글 종일 일정 규칙)
  const compactStart = toCompact(startISO);
  const compactEnd = endISO === startISO ? toCompact(addDaysISO(startISO, 1)) : toCompact(endISO);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text,
    dates: `${compactStart}/${compactEnd}`,
    details,
  });

  return `${BASE}?${params.toString()}`;
}
