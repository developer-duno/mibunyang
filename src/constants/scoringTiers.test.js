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
import { describe, it, expect } from 'vitest';
import {
  SAFE_CREDIT_GRADES,
  FUTURE_WEIGHT_MAP,
  PRICE_NO_DATA_DEFAULTS,
  tierMax,
  tierMin,
  SUBWAY_DIST_TIERS,
  IC_DIST_TIERS,
  UNIT_TIERS,
} from '@/constants/scoringTiers';

describe('SAFE_CREDIT_GRADES', () => {
  // 안전 등급은 정확히 7개여야 한다
  it('7개의 안전 신용등급이 존재한다', () => {
    expect(SAFE_CREDIT_GRADES).toHaveLength(7);
  });

  // AAA, AA+, AA, AA-, A+, A, A- 포함
  it('AAA부터 A-까지 포함한다', () => {
    const expected = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-'];
    expected.forEach(grade => {
      expect(SAFE_CREDIT_GRADES).toContain(grade);
    });
  });
});

describe('FUTURE_WEIGHT_MAP', () => {
  // 8개 조합 키가 존재
  it('8개 조합 키가 존재한다', () => {
    expect(Object.keys(FUTURE_WEIGHT_MAP)).toHaveLength(8);
  });

  // 모든 조합의 가중치 합계 = 1.00
  it('모든 조합의 가중치 합계가 1.00이다', () => {
    Object.values(FUTURE_WEIGHT_MAP).forEach((weights) => {
      const sum = weights.tr + weights.city + weights.pop + weights.ind;
      expect(sum).toBeCloseTo(1.0, 10);
    });
  });

  // 모든 개발 없음 -> 인구 100%
  it('모든 개발 없으면 인구 가중치가 1.00이다', () => {
    const w = FUTURE_WEIGHT_MAP['0,0,0'];
    expect(w.pop).toBe(1.0);
    expect(w.tr).toBe(0);
    expect(w.city).toBe(0);
    expect(w.ind).toBe(0);
  });
});

describe('PRICE_NO_DATA_DEFAULTS', () => {
  // 4개 키 존재
  it('dev, jr, pir, psr 4개 키가 존재한다', () => {
    expect(PRICE_NO_DATA_DEFAULTS).toHaveProperty('dev');
    expect(PRICE_NO_DATA_DEFAULTS).toHaveProperty('jr');
    expect(PRICE_NO_DATA_DEFAULTS).toHaveProperty('pir');
    expect(PRICE_NO_DATA_DEFAULTS).toHaveProperty('psr');
  });

  // 모든 기본값이 0~100 범위
  it('모든 기본값이 0~100 범위이다', () => {
    Object.values(PRICE_NO_DATA_DEFAULTS).forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });
});

describe('tierMax', () => {
  // value <= max 조건으로 첫 매칭 반환
  it('value <= max 조건으로 첫 매칭을 반환한다', () => {
    expect(tierMax(300, SUBWAY_DIST_TIERS)).toBe(25);
    expect(tierMax(500, SUBWAY_DIST_TIERS)).toBe(21);
    expect(tierMax(700, SUBWAY_DIST_TIERS)).toBe(16);
    expect(tierMax(1000, SUBWAY_DIST_TIERS)).toBe(11);
    expect(tierMax(1500, SUBWAY_DIST_TIERS)).toBe(6);
  });

  // 모든 tier 초과 시 fallback 반환
  it('모든 tier 초과 시 fallback을 반환한다', () => {
    expect(tierMax(9999, SUBWAY_DIST_TIERS, 0)).toBe(0);
    expect(tierMax(9999, SUBWAY_DIST_TIERS, 42)).toBe(42);
  });

  // 경계값 테스트
  it('경계값에서 정확히 매칭한다', () => {
    expect(tierMax(300, SUBWAY_DIST_TIERS)).toBe(25);
    expect(tierMax(301, SUBWAY_DIST_TIERS)).toBe(21);
  });
});

describe('tierMin', () => {
  // value >= min 조건으로 첫 매칭 반환
  it('value >= min 조건으로 첫 매칭을 반환한다', () => {
    expect(tierMin(1500, UNIT_TIERS)).toBe(15);
    expect(tierMin(1000, UNIT_TIERS)).toBe(13);
    expect(tierMin(700, UNIT_TIERS)).toBe(10);
    expect(tierMin(400, UNIT_TIERS)).toBe(7);
  });

  // 모든 tier 미달 시 fallback 반환
  it('모든 tier 미달 시 fallback을 반환한다', () => {
    expect(tierMin(100, UNIT_TIERS, 0)).toBe(0);
    expect(tierMin(100, UNIT_TIERS, 99)).toBe(99);
  });
});

// --- 추가 테스트 ---

describe('SUBWAY_DIST_TIERS 모든 경계값', () => {
  // 각 경계값의 정확한 값과 +1 테스트
  it('300m 이하 = 25점', () => { expect(tierMax(300, SUBWAY_DIST_TIERS)).toBe(25); });
  it('301m = 21점 (다음 구간)', () => { expect(tierMax(301, SUBWAY_DIST_TIERS)).toBe(21); });
  it('500m 이하 = 21점', () => { expect(tierMax(500, SUBWAY_DIST_TIERS)).toBe(21); });
  it('501m = 16점', () => { expect(tierMax(501, SUBWAY_DIST_TIERS)).toBe(16); });
  it('700m 이하 = 16점', () => { expect(tierMax(700, SUBWAY_DIST_TIERS)).toBe(16); });
  it('701m = 11점', () => { expect(tierMax(701, SUBWAY_DIST_TIERS)).toBe(11); });
  it('1000m 이하 = 11점', () => { expect(tierMax(1000, SUBWAY_DIST_TIERS)).toBe(11); });
  it('1001m = 6점', () => { expect(tierMax(1001, SUBWAY_DIST_TIERS)).toBe(6); });
  it('1500m 이하 = 6점', () => { expect(tierMax(1500, SUBWAY_DIST_TIERS)).toBe(6); });
  it('1501m = 0점 (fallback)', () => { expect(tierMax(1501, SUBWAY_DIST_TIERS)).toBe(0); });
  it('0m = 25점', () => { expect(tierMax(0, SUBWAY_DIST_TIERS)).toBe(25); });
});

describe('IC_DIST_TIERS 모든 경계값', () => {
  it('2km 이하 = 20점', () => { expect(tierMax(2, IC_DIST_TIERS)).toBe(20); });
  it('2.1km = 14점', () => { expect(tierMax(2.1, IC_DIST_TIERS)).toBe(14); });
  it('5km 이하 = 14점', () => { expect(tierMax(5, IC_DIST_TIERS)).toBe(14); });
  it('5.1km = 8점', () => { expect(tierMax(5.1, IC_DIST_TIERS)).toBe(8); });
  it('10km 이하 = 8점', () => { expect(tierMax(10, IC_DIST_TIERS)).toBe(8); });
  it('10.1km = 0점 (fallback)', () => { expect(tierMax(10.1, IC_DIST_TIERS)).toBe(0); });
});

describe('tierMax/tierMin — 빈 배열 → 0 폴백', () => {
  it('tierMax 빈 배열 → 기본 fallback 0', () => {
    expect(tierMax(500, [])).toBe(0);
  });
  it('tierMax 빈 배열 + 커스텀 fallback', () => {
    expect(tierMax(500, [], 42)).toBe(42);
  });
  it('tierMin 빈 배열 → 기본 fallback 0', () => {
    expect(tierMin(500, [])).toBe(0);
  });
  it('tierMin 빈 배열 + 커스텀 fallback', () => {
    expect(tierMin(500, [], 99)).toBe(99);
  });
});
