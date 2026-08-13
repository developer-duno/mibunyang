// @ts-check
/**
 * scoringTiers 상수 테스트
 *
 * 스코어링 엔진에서 사용하는 룩업 테이블 상수의 무결성을 검증합니다.
 * - SAFE_CREDIT_GRADES: 안전 등급 목록 7개
 * - FUTURE_WEIGHT_MAP: 8개 키의 가중치 합계가 항상 1.00
 * - PRICE_NO_DATA_DEFAULTS: 데이터 부재 시 기본값
 * - tierMax/tierMin: 임계값 매칭 함수
 */
import { describe, it, expect } from "vitest";
import {
  SAFE_CREDIT_GRADES,
  CREDIT_GRADE_SCORES,
  FUTURE_WEIGHTS,
  FUTURE_AXIS_MAX,
  FUTURE_RAW_MAX,
  PRICE_NO_DATA_DEFAULTS,
  tierMax,
  tierMin,
  SUBWAY_DIST_TIERS,
  IC_DIST_TIERS,
  UNIT_TIERS,
} from "@/constants/scoringTiers";

describe("SAFE_CREDIT_GRADES", () => {
  // 안전 등급은 정확히 7개여야 한다
  it("7개의 안전 신용등급이 존재한다", () => {
    expect(SAFE_CREDIT_GRADES).toHaveLength(7);
  });

  // AAA, AA+, AA, AA-, A+, A, A- 포함
  it("AAA부터 A-까지 포함한다", () => {
    const expected = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-"];
    expected.forEach((grade) => {
      expect(SAFE_CREDIT_GRADES).toContain(grade);
    });
  });
});

describe("CREDIT_GRADE_SCORES", () => {
  // estimateCreditGrade(dart-builders.mjs)가 생성하는 등급 6개를 전수 커버해야 한다.
  // 누락 시 scoreRisk.ts의 `?? CREDIT_DEFAULT(30)` 폴백으로 떨어져 위험 역전 발생.
  it("estimateCreditGrade가 생성하는 모든 등급(A,A-,BBB,BB,B,CCC)을 포함한다", () => {
    const generated = ["A", "A-", "BBB", "BB", "B", "CCC"];
    generated.forEach((grade) => {
      expect(CREDIT_GRADE_SCORES).toHaveProperty(grade);
    });
  });

  // B(부채251~350%)·CCC(>350%)는 BB(201~250%)보다 위험 → 위험점수 단조 증가
  it("위험 등급 순서대로 점수가 단조 증가한다 (AA<A<BBB<BB<B<CCC)", () => {
    const order = ["AA", "A", "BBB", "BB", "B", "CCC"];
    for (let i = 1; i < order.length; i++) {
      expect(CREDIT_GRADE_SCORES[order[i]]).toBeGreaterThan(CREDIT_GRADE_SCORES[order[i - 1]]);
    }
  });

  // 모든 점수 0~100 범위
  it("모든 등급 점수가 0~100 범위이다", () => {
    Object.values(CREDIT_GRADE_SCORES).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });
});

// 세션511: 동적 재분배(FUTURE_WEIGHT_MAP) 폐기 → 고정 가중치.
// 옛 구조는 8조합 합이 전부 1.00 이라 "호재가 없으면 그 몫이 100% 인구로" 갔고, 그래서
// 호재를 가진 단지가 구조적으로 손해를 봤다(보유 762곳 중 486곳 역전).
describe("FUTURE_WEIGHTS (고정 가중치)", () => {
  it("네 축 가중치 합이 1.00 이다", () => {
    const sum = FUTURE_WEIGHTS.pop + FUTURE_WEIGHTS.tr + FUTURE_WEIGHTS.city + FUTURE_WEIGHTS.ind;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("호재 몫(교통+도시+산업)이 0.45 다 — 실측으로 고른 값", () => {
    // 0.35 면 인구 설명력 85.0%(현행 75.7%보다 악화), 0.45 면 70.1%, 0.50 이면 61.6%(인구가 너무 약함)
    const dev = FUTURE_WEIGHTS.tr + FUTURE_WEIGHTS.city + FUTURE_WEIGHTS.ind;
    expect(dev).toBeCloseTo(0.45, 10);
  });

  it("인구가 여전히 가장 큰 축이다 (배경 신호)", () => {
    expect(FUTURE_WEIGHTS.pop).toBeGreaterThan(FUTURE_WEIGHTS.tr);
    expect(FUTURE_WEIGHTS.pop).toBeGreaterThan(FUTURE_WEIGHTS.city + FUTURE_WEIGHTS.ind);
  });

  it("모든 가중치가 비음수 — 채우면 내려갈 수 없다(단조성의 근거)", () => {
    for (const w of Object.values(FUTURE_WEIGHTS)) expect(w).toBeGreaterThanOrEqual(0);
  });

  it("FUTURE_RAW_MAX 는 축 상한 × 가중치의 합이다 (손으로 적으면 척도가 어긋난다)", () => {
    const expected =
      FUTURE_AXIS_MAX.pop * FUTURE_WEIGHTS.pop +
      FUTURE_AXIS_MAX.tr * FUTURE_WEIGHTS.tr +
      FUTURE_AXIS_MAX.city * FUTURE_WEIGHTS.city +
      FUTURE_AXIS_MAX.ind * FUTURE_WEIGHTS.ind;
    expect(FUTURE_RAW_MAX).toBeCloseTo(expected, 10);
    expect(FUTURE_RAW_MAX).toBeLessThan(100); // 도시·산업 최고가 80이라 100 에 못 미친다 → 정규화 필요
  });
});

describe("PRICE_NO_DATA_DEFAULTS", () => {
  // 4개 키 존재
  it("dev, jr, pir, psr 4개 키가 존재한다", () => {
    expect(PRICE_NO_DATA_DEFAULTS).toHaveProperty("dev");
    expect(PRICE_NO_DATA_DEFAULTS).toHaveProperty("jr");
    expect(PRICE_NO_DATA_DEFAULTS).toHaveProperty("pir");
    expect(PRICE_NO_DATA_DEFAULTS).toHaveProperty("psr");
  });

  // 모든 기본값이 0~100 범위
  it("모든 기본값이 0~100 범위이다", () => {
    Object.values(PRICE_NO_DATA_DEFAULTS).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });
});

describe("tierMax", () => {
  // value <= max 조건으로 첫 매칭 반환
  it("value <= max 조건으로 첫 매칭을 반환한다", () => {
    expect(tierMax(300, SUBWAY_DIST_TIERS)).toBe(25);
    expect(tierMax(500, SUBWAY_DIST_TIERS)).toBe(21);
    expect(tierMax(700, SUBWAY_DIST_TIERS)).toBe(16);
    expect(tierMax(1000, SUBWAY_DIST_TIERS)).toBe(11);
    expect(tierMax(1500, SUBWAY_DIST_TIERS)).toBe(6);
  });

  // 모든 tier 초과 시 fallback 반환
  it("모든 tier 초과 시 fallback을 반환한다", () => {
    expect(tierMax(9999, SUBWAY_DIST_TIERS, 0)).toBe(0);
    expect(tierMax(9999, SUBWAY_DIST_TIERS, 42)).toBe(42);
  });

  // 경계값 테스트
  it("경계값에서 정확히 매칭한다", () => {
    expect(tierMax(300, SUBWAY_DIST_TIERS)).toBe(25);
    expect(tierMax(301, SUBWAY_DIST_TIERS)).toBe(21);
  });
});

describe("tierMin", () => {
  // value >= min 조건으로 첫 매칭 반환
  it("value >= min 조건으로 첫 매칭을 반환한다", () => {
    expect(tierMin(1500, UNIT_TIERS)).toBe(15);
    expect(tierMin(1000, UNIT_TIERS)).toBe(13);
    expect(tierMin(700, UNIT_TIERS)).toBe(10);
    expect(tierMin(400, UNIT_TIERS)).toBe(7);
  });

  // 모든 tier 미달 시 fallback 반환
  it("모든 tier 미달 시 fallback을 반환한다", () => {
    expect(tierMin(100, UNIT_TIERS, 0)).toBe(0);
    expect(tierMin(100, UNIT_TIERS, 99)).toBe(99);
  });
});

// --- 추가 테스트 ---

describe("SUBWAY_DIST_TIERS 모든 경계값", () => {
  // 각 경계값의 정확한 값과 +1 테스트
  it("300m 이하 = 25점", () => {
    expect(tierMax(300, SUBWAY_DIST_TIERS)).toBe(25);
  });
  it("301m = 21점 (다음 구간)", () => {
    expect(tierMax(301, SUBWAY_DIST_TIERS)).toBe(21);
  });
  it("500m 이하 = 21점", () => {
    expect(tierMax(500, SUBWAY_DIST_TIERS)).toBe(21);
  });
  it("501m = 16점", () => {
    expect(tierMax(501, SUBWAY_DIST_TIERS)).toBe(16);
  });
  it("700m 이하 = 16점", () => {
    expect(tierMax(700, SUBWAY_DIST_TIERS)).toBe(16);
  });
  it("701m = 11점", () => {
    expect(tierMax(701, SUBWAY_DIST_TIERS)).toBe(11);
  });
  it("1000m 이하 = 11점", () => {
    expect(tierMax(1000, SUBWAY_DIST_TIERS)).toBe(11);
  });
  it("1001m = 6점", () => {
    expect(tierMax(1001, SUBWAY_DIST_TIERS)).toBe(6);
  });
  it("1500m 이하 = 6점", () => {
    expect(tierMax(1500, SUBWAY_DIST_TIERS)).toBe(6);
  });
  it("1501m = 0점 (fallback)", () => {
    expect(tierMax(1501, SUBWAY_DIST_TIERS)).toBe(0);
  });
  it("0m = 25점", () => {
    expect(tierMax(0, SUBWAY_DIST_TIERS)).toBe(25);
  });
});

// 경계 숫자를 하드코딩하지 않는다 — 세션500 에 IC 경계를 2/5/10 → 1.3/2.5/10 으로 정정할 때
// 옛 판(2km=20점 … 을 그대로 적어둔 형태)이 통째로 red 가 됐다. 경계값 검증의 본질은
// "경계 위 = 그 티어 점수 / 경계 바로 밖 = 다음 티어 점수(마지막이면 fallback 0)" 이므로
// 티어에서 값을 뽑는다. tierMax 가 `<` 로 뒤집히면 첫 단정부터 red 가 되어 여전히 유효하다.
describe("IC_DIST_TIERS 모든 경계값 (경계는 티어에서 유도)", () => {
  IC_DIST_TIERS.forEach((t, i) => {
    const next = IC_DIST_TIERS[i + 1];
    it(`${t.max}km 이하 = ${t.score}점`, () => {
      expect(tierMax(t.max, IC_DIST_TIERS)).toBe(t.score);
    });
    it(`${t.max}km 바로 밖 = ${next ? `${next.score}점` : "0점 (fallback)"}`, () => {
      expect(tierMax(t.max + 0.1, IC_DIST_TIERS)).toBe(next ? next.score : 0);
    });
  });
});

describe("tierMax/tierMin — 빈 배열 → 0 폴백", () => {
  it("tierMax 빈 배열 → 기본 fallback 0", () => {
    expect(tierMax(500, [])).toBe(0);
  });
  it("tierMax 빈 배열 + 커스텀 fallback", () => {
    expect(tierMax(500, [], 42)).toBe(42);
  });
  it("tierMin 빈 배열 → 기본 fallback 0", () => {
    expect(tierMin(500, [])).toBe(0);
  });
  it("tierMin 빈 배열 + 커스텀 fallback", () => {
    expect(tierMin(500, [], 99)).toBe(99);
  });
});
