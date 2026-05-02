// googleCalendar 빌더 단위 테스트 (spec § 5-4)
import { describe, it, expect } from "vitest";
import { buildGoogleCalendarUrl, parseDateLoose, addDaysISO } from "./googleCalendar";

describe("parseDateLoose", () => {
  it("'YYYY-MM-DD' 그대로 ISO 반환", () => {
    expect(parseDateLoose("2026-05-08")).toBe("2026-05-08");
  });

  it("'YYYY.MM.DD' → ISO", () => {
    expect(parseDateLoose("2026.05.10")).toBe("2026-05-10");
  });

  it("Date 객체 → ISO", () => {
    expect(parseDateLoose(new Date("2026-06-15T00:00:00"))).toBe("2026-06-15");
  });

  it("null/빈/잘못된 → null", () => {
    expect(parseDateLoose(null)).toBeNull();
    expect(parseDateLoose("")).toBeNull();
    expect(parseDateLoose("미정")).toBeNull();
    expect(parseDateLoose(123)).toBeNull();
  });
});

describe("addDaysISO", () => {
  it("일자 더하기", () => {
    expect(addDaysISO("2026-05-08", 3)).toBe("2026-05-11");
  });

  it("월 경계 넘김", () => {
    expect(addDaysISO("2026-05-30", 3)).toBe("2026-06-02");
  });

  it("음수 → 빼기", () => {
    expect(addDaysISO("2026-05-08", -1)).toBe("2026-05-07");
  });

  it("잘못된 ISO → null", () => {
    expect(addDaysISO("invalid", 1)).toBeNull();
  });
});

describe("buildGoogleCalendarUrl — 청약 일정 등록 URL 빌더", () => {
  const baseApt = {
    name: "○○자이",
    region: "서울특별시",
    gu: "강동구",
    presaleRecruitDate: "2026-05-08",
    presaleSchedule: { scheduleName: "청약 마감", dateInfo: "2026.05.12", schdl_info: null },
    presaleHousingType: "민영주택",
    presaleInquiry: "1588-0000",
  };

  it("정상 케이스 — base URL + 필수 파라미터 포함", () => {
    const url = buildGoogleCalendarUrl(baseApt);
    expect(url).toMatch(/^https:\/\/www\.google\.com\/calendar\/render\?/);
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20260508%2F20260512");
  });

  it("URL 인코딩 — 한글·공백 자동 인코딩", () => {
    const url = buildGoogleCalendarUrl(baseApt);
    // text=○○자이+청약 → 인코딩됨
    expect(url).toContain("text=");
    expect(url).toMatch(/text=%[0-9A-F]/i);
    // 본문 details 의 줄바꿈 %0A
    expect(url).toContain("details=");
    expect(url).toContain("%0A");
  });

  it("recruit_date 없음 → null", () => {
    const url = buildGoogleCalendarUrl({ ...baseApt, presaleRecruitDate: null });
    expect(url).toBeNull();
  });

  it("recruit_date 비정형 텍스트 → null", () => {
    const url = buildGoogleCalendarUrl({ ...baseApt, presaleRecruitDate: "미정" });
    expect(url).toBeNull();
  });

  it("schedule 마감일 없음 → 시작일+3 일 fallback", () => {
    const url = buildGoogleCalendarUrl({ ...baseApt, presaleSchedule: null });
    expect(url).toContain("dates=20260508%2F20260511");
  });

  it("schedule.dateInfo 비정형 → 시작일+3 일 fallback", () => {
    const url = buildGoogleCalendarUrl({
      ...baseApt,
      presaleSchedule: { scheduleName: "청약일", dateInfo: "5월 8일", schdl_info: null },
    });
    expect(url).toContain("dates=20260508%2F20260511");
  });

  it("시작일 == 종료일 → 다음날을 끝으로 (구글 종일 일정 규칙)", () => {
    const url = buildGoogleCalendarUrl({
      ...baseApt,
      presaleSchedule: { scheduleName: "청약일", dateInfo: "2026.05.08", schdl_info: null },
    });
    expect(url).toContain("dates=20260508%2F20260509");
  });

  it("region/gu 한쪽만 있어도 details 정상", () => {
    const url = buildGoogleCalendarUrl({ ...baseApt, gu: null });
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("서울특별시");
  });

  it("housing_type/inquiry 없으면 details 에서 생략", () => {
    const url = buildGoogleCalendarUrl({
      ...baseApt,
      presaleHousingType: null,
      presaleInquiry: null,
    });
    // URLSearchParams 는 공백을 '+' 로 인코딩 → '+' 도 공백으로 풀어 정규화
    const decoded = decodeURIComponent(url).replace(/\+/g, " ");
    expect(decoded).not.toContain("유형:");
    expect(decoded).not.toContain("문의:");
    expect(decoded).toContain("출처: 미분양 비교 엔진");
  });

  it("apt 가 null/undefined → null", () => {
    expect(buildGoogleCalendarUrl(null)).toBeNull();
    expect(buildGoogleCalendarUrl(undefined)).toBeNull();
  });

  it("opts.endDate 명시 → schedule 보다 우선", () => {
    const url = buildGoogleCalendarUrl(baseApt, { endDate: "2026-05-20" });
    expect(url).toContain("dates=20260508%2F20260520");
  });
});
