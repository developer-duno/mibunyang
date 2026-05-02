// /api/upcoming 단위 테스트
import { describe, it, expect } from "vitest";
import { extractDates } from "./upcoming.js";

describe("extractDates — 캘린더 날짜 추출 (spec § 3-1-A·B)", () => {
  it("presaleRecruitDate (YYYY-MM-DD) → apply_start 매핑", () => {
    const apt = { presaleRecruitDate: "2026-05-08", presaleSchedule: null };
    const result = extractDates(apt);
    expect(result).toEqual([{ date: "2026-05-08", event: "apply_start" }]);
  });

  it("presaleSchedule.dateInfo (YYYY.MM.DD) + scheduleName 청약 → apply_start", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "1순위 청약일", dateInfo: "2026.05.10", schdl_info: null },
    };
    const result = extractDates(apt);
    expect(result).toEqual([{ date: "2026-05-10", event: "apply_start" }]);
  });

  it("scheduleName 당첨자 발표 → winner_announce", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "당첨자 발표", dateInfo: "2026.05.20", schdl_info: null },
    };
    expect(extractDates(apt)[0].event).toBe("winner_announce");
  });

  it("scheduleName 마감 → apply_end", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "청약 마감", dateInfo: "2026.05.12", schdl_info: null },
    };
    expect(extractDates(apt)[0].event).toBe("apply_end");
  });

  it("dateInfo 정규식 미일치 → skip (캘린더 매핑 X)", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "청약일", dateInfo: "5월 8일", schdl_info: null },
    };
    expect(extractDates(apt)).toEqual([]);
  });

  it("presaleSchedule 문자열 형태 (B형태) → skip (캘린더 매핑 X, spec § 3-1-A 정책)", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: "5월 청약 예정",
    };
    expect(extractDates(apt)).toEqual([]);
  });

  it("presaleSchedule null (C형태) + presaleRecruitDate null → 빈 배열", () => {
    const apt = { presaleRecruitDate: null, presaleSchedule: null };
    expect(extractDates(apt)).toEqual([]);
  });

  it("presaleRecruitDate 비정형 텍스트 (예: '미정') → skip", () => {
    const apt = { presaleRecruitDate: "미정", presaleSchedule: null };
    expect(extractDates(apt)).toEqual([]);
  });

  it("presaleRecruitDate + presaleSchedule 둘 다 → 2건 반환", () => {
    const apt = {
      presaleRecruitDate: "2026-05-08",
      presaleSchedule: { scheduleName: "당첨자 발표", dateInfo: "2026.05.20", schdl_info: null },
    };
    const result = extractDates(apt);
    expect(result).toHaveLength(2);
    expect(result[0].event).toBe("apply_start");
    expect(result[1].event).toBe("winner_announce");
  });
});
