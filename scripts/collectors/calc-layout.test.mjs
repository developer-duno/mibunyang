/**
 * calc-layout.mjs 테스트 — 베이 수, 건물유형, 레이아웃 문자열, 중앙값
 */
import { describe, it, expect, vi } from "vitest";

// loadEnv + getSupabase 호출 방지 (모듈 로드 시 사이드이펙트)
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { estimateBayCount, estimateBuildingType, toLayoutString, median } = await import("./calc-layout.mjs");

describe("estimateBayCount", () => {
  // 경계값: 100m² 이상 → 4베이
  it("100m² 이상이면 4베이를 반환한다", () => {
    expect(estimateBayCount(100)).toBe(4);
    expect(estimateBayCount(120)).toBe(4);
  });

  // 60~99m² → 3베이
  it("60~99m²이면 3베이를 반환한다", () => {
    expect(estimateBayCount(60)).toBe(3);
    expect(estimateBayCount(84)).toBe(3);
    expect(estimateBayCount(99)).toBe(3);
  });

  // 60m² 미만 → 2베이
  it("60m² 미만이면 2베이를 반환한다", () => {
    expect(estimateBayCount(59)).toBe(2);
    expect(estimateBayCount(30)).toBe(2);
  });
});

describe("estimateBuildingType", () => {
  // 이름에 "타워" 포함 + 고층
  it("이름에 '타워' 포함 + 고층이면 타워를 반환한다", () => {
    // "타워"(+1) + 30층(>= 25, +1) + 밀도 5(<=6, +1) = score 3 → 타워
    expect(estimateBuildingType("힐스테이트타워", 30, 150)).toBe("타워");
  });

  // 고층(25+) + 저밀도(≤6) → 타워 (score >= 2)
  it("고층(25+) + 저밀도(≤6)이면 타워를 반환한다", () => {
    // 40층, 200세대 → 밀도 5 → score: 고층(+1) + 저밀도(+1) = 2
    expect(estimateBuildingType("테스트아파트", 40, 200)).toBe("타워");
  });

  // 저층(15미만) + 고밀도(≥12) → 판상 (score <= -2)
  it("저층 + 고밀도이면 판상을 반환한다", () => {
    // 10층, 150세대 → 밀도 15 → score: 저층(-1) + 고밀도(-1) = -2
    expect(estimateBuildingType("테스트아파트", 10, 150)).toBe("판상");
  });

  // score 0 → 판상 (기본값)
  it("score 0이면 판상을 반환한다", () => {
    expect(estimateBuildingType("아파트", 20, 200)).toBe("판상");
  });
});

describe("toLayoutString", () => {
  it("2베이 이하는 '2베이이하'를 반환한다", () => {
    expect(toLayoutString(2, "타워")).toBe("2베이이하");
    expect(toLayoutString(1, "판상")).toBe("2베이이하");
  });

  it("3베이+타워 → '3베이타워'", () => {
    expect(toLayoutString(3, "타워")).toBe("3베이타워");
  });

  it("4베이+판상 → '4베이판상'", () => {
    expect(toLayoutString(4, "판상")).toBe("4베이판상");
  });
});

describe("median", () => {
  it("홀수 배열의 중앙값을 반환한다", () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it("짝수 배열의 중앙값(평균)을 반환한다", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("빈 배열은 null을 반환한다", () => {
    expect(median([])).toBeNull();
  });

  it("단일 요소 배열은 해당 값을 반환한다", () => {
    expect(median([42])).toBe(42);
  });
});
