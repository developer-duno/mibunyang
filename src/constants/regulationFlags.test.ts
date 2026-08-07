import { describe, it, expect } from "vitest";
import { REGULATION_FLAGS, REGULATION_HINT, activeRegulations, formatAnnouncementBasis } from "./regulationFlags";

describe("REGULATION_FLAGS", () => {
  it("7종 전부·중복 0 (DB 컬럼 수와 일치)", () => {
    expect(REGULATION_FLAGS).toHaveLength(7);
    expect(new Set(REGULATION_FLAGS.map((f) => f.key)).size).toBe(7);
    expect(new Set(REGULATION_FLAGS.map((f) => f.label)).size).toBe(7);
  });

  it("규제 3종이 사업유형 4종보다 앞 (손님 관심도 순)", () => {
    expect(REGULATION_FLAGS.slice(0, 3).map((f) => f.label)).toEqual(["조정대상지역", "투기과열지구", "분양가상한제"]);
  });
});

describe("activeRegulations", () => {
  it("true 인 것만, REGULATION_FLAGS 차례로 돌려준다", () => {
    // 입력 키 순서를 일부러 뒤집어 넣는다 — 출력이 입력 순서를 따라가면 안 된다
    expect(
      activeRegulations({
        price_cap_applied: true,
        adjustment_target_area: true,
        speculation_overheated: true,
      })
    ).toEqual(["조정대상지역", "투기과열지구", "분양가상한제"]);
  });

  it("전부 false 면 빈 배열 (호출처가 행을 생략한다)", () => {
    const allFalse = Object.fromEntries(REGULATION_FLAGS.map((f) => [f.key, false]));
    expect(activeRegulations(allFalse)).toEqual([]);
  });

  it("null(미수집)은 false 와 똑같이 제외한다", () => {
    const allNull = Object.fromEntries(REGULATION_FLAGS.map((f) => [f.key, null]));
    expect(activeRegulations(allNull)).toEqual([]);
  });

  it("schedule 자체가 null/undefined 여도 던지지 않는다", () => {
    expect(activeRegulations(null)).toEqual([]);
    expect(activeRegulations(undefined)).toEqual([]);
  });

  it("사업유형 4종도 노출 대상이다 (7종 전부 — 사장님 결정)", () => {
    expect(
      activeRegulations({
        redevelopment_biz: true,
        public_housing_district: true,
        large_scale_district: true,
        metro_private_public_housing: true,
      })
    ).toEqual(["정비사업", "공공주택지구", "대규모 택지개발지구", "수도권 민영 공공택지"]);
  });
});

describe("formatAnnouncementBasis", () => {
  it("YYYY-MM-DD → 'YYYY.MM 공고 기준'", () => {
    expect(formatAnnouncementBasis("2026-03-30")).toBe("2026.03 공고 기준");
  });

  it("옛 공고도 그 시점 그대로 (거짓 방지의 핵심)", () => {
    expect(formatAnnouncementBasis("2021-05-14")).toBe("2021.05 공고 기준");
  });

  it("없거나 형식이 어긋나면 null → 기준 문구만 생략", () => {
    expect(formatAnnouncementBasis(null)).toBeNull();
    expect(formatAnnouncementBasis(undefined)).toBeNull();
    expect(formatAnnouncementBasis("")).toBeNull();
    expect(formatAnnouncementBasis("2026")).toBeNull();
  });
});

describe("REGULATION_HINT", () => {
  // 이 문구가 시점 성질을 설명하지 않으면 A안의 근거가 무너진다.
  it("규제가 이후 바뀔 수 있다는 뜻을 담는다", () => {
    expect(REGULATION_HINT).toContain("공고");
    expect(REGULATION_HINT).toMatch(/풀리|해제/);
  });
});
