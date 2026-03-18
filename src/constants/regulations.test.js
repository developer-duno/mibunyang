/**
 * regulations 상수 테스트
 *
 * 규제지역 판별 및 LTV 대출한도 계산 로직을 검증합니다.
 * - getZone: 기본값 'normal' 반환
 * - calcLTV: 9억 이하/초과 시 차등 적용
 */
import { describe, it, expect } from 'vitest';
import { getZone, calcLTV, LTV_RATES, ZONE_TYPE } from '@/constants/regulations';

describe('getZone', () => {
  // 2023.01 전면 해제 이후 모든 지역이 normal
  it('기본값은 normal이다', () => {
    expect(getZone('서울', '강남구')).toBe('normal');
    expect(getZone('경기', '수원시')).toBe('normal');
    expect(getZone('부산', '해운대구')).toBe('normal');
  });

  // null/undefined 입력도 에러 없이 normal 반환
  it('null/undefined 입력 시에도 normal을 반환한다', () => {
    expect(getZone(null, null)).toBe('normal');
    expect(getZone(undefined, undefined)).toBe('normal');
    expect(getZone('', '')).toBe('normal');
  });

  // 복합값(쉼표 구분) 처리
  it('복합 region 값에서 첫 번째 값만 사용한다', () => {
    expect(getZone('경기,서울,인천', '수원시')).toBe('normal');
  });
});

describe('calcLTV', () => {
  // 비규제 지역, 9억 이하
  it('비규제 9억 이하: price * 0.70', () => {
    const result = calcLTV(50000, 'normal');
    expect(result).toBe(Math.round(50000 * 0.70));
  });

  // 비규제 지역, 9억 초과
  it('비규제 9억 초과: 9억 * 0.70 + 초과분 * 0.60', () => {
    const price = 120000; // 12억
    const expected = Math.round(90000 * 0.70 + (120000 - 90000) * 0.60);
    expect(calcLTV(price, 'normal')).toBe(expected);
  });

  // 투기과열지구, 9억 이하
  it('투기과열 9억 이하: price * 0.40', () => {
    expect(calcLTV(50000, 'speculative')).toBe(Math.round(50000 * 0.40));
  });

  // 투기과열지구, 9억 초과
  it('투기과열 9억 초과: 9억 * 0.40 + 초과분 * 0.20', () => {
    const price = 120000;
    const expected = Math.round(90000 * 0.40 + 30000 * 0.20);
    expect(calcLTV(price, 'speculative')).toBe(expected);
  });

  // 조정대상지역
  it('조정대상 9억 이하: price * 0.50', () => {
    expect(calcLTV(50000, 'overheated')).toBe(Math.round(50000 * 0.50));
  });

  // 9억 정확히
  it('정확히 9억(90000만원)은 이하 구간 적용', () => {
    expect(calcLTV(90000, 'normal')).toBe(Math.round(90000 * 0.70));
  });
});

describe('ZONE_TYPE', () => {
  // 3가지 구역 타입 존재
  it('3가지 구역 타입이 존재한다', () => {
    expect(Object.keys(ZONE_TYPE)).toHaveLength(3);
    expect(ZONE_TYPE.speculative).toBe('투기과열지구');
    expect(ZONE_TYPE.overheated).toBe('조정대상지역');
    expect(ZONE_TYPE.normal).toBe('비규제지역');
  });
});

describe('LTV_RATES', () => {
  // 모든 zone에 under9, over9 비율 존재
  it('모든 zone에 under9, over9 비율이 존재한다', () => {
    ['speculative', 'overheated', 'normal'].forEach(zone => {
      expect(LTV_RATES[zone]).toHaveProperty('under9');
      expect(LTV_RATES[zone]).toHaveProperty('over9');
      expect(LTV_RATES[zone].under9).toBeGreaterThan(LTV_RATES[zone].over9);
    });
  });
});

// --- 추가 테스트 ---

describe('calcLTV — 9억 경계 정밀 테스트', () => {
  // 89,999만원 (8억 9,999만원) → 이하 구간
  it('89999만원 (9억 미만): under9 비율만 적용', () => {
    expect(calcLTV(89999, 'normal')).toBe(Math.round(89999 * 0.70));
  });

  // 정확히 90,000만원 (9억) → 이하 구간
  it('90000만원 (정확히 9억): under9 비율만 적용', () => {
    expect(calcLTV(90000, 'normal')).toBe(Math.round(90000 * 0.70));
  });

  // 90,001만원 (9억 1만원) → 초과 구간 진입
  it('90001만원 (9억 초과 1만원): under9 + over9 차등', () => {
    const expected = Math.round(90000 * 0.70 + 1 * 0.60);
    expect(calcLTV(90001, 'normal')).toBe(expected);
  });

  // 투기과열지구 경계
  it('투기과열 89999만원 → under9', () => {
    expect(calcLTV(89999, 'speculative')).toBe(Math.round(89999 * 0.40));
  });
  it('투기과열 90001만원 → 차등', () => {
    expect(calcLTV(90001, 'speculative')).toBe(Math.round(90000 * 0.40 + 1 * 0.20));
  });

  // 조정대상 경계
  it('조정대상 89999만원 → under9', () => {
    expect(calcLTV(89999, 'overheated')).toBe(Math.round(89999 * 0.50));
  });
  it('조정대상 90001만원 → 차등', () => {
    expect(calcLTV(90001, 'overheated')).toBe(Math.round(90000 * 0.50 + 1 * 0.30));
  });
});

describe('calcLTV — null zone → 비규제 기본값', () => {
  // getZone이 항상 'normal' 반환하므로, 직접 normal 전달과 동일해야 함
  it('null zone 사용 시 getZone 결과인 normal과 동일', () => {
    const zone = getZone(null, null); // 'normal'
    expect(calcLTV(50000, zone)).toBe(Math.round(50000 * 0.70));
  });

  it('undefined zone 사용 시에도 normal', () => {
    const zone = getZone(undefined, undefined);
    expect(zone).toBe('normal');
    expect(calcLTV(120000, zone)).toBe(Math.round(90000 * 0.70 + 30000 * 0.60));
  });
});

describe('getZone — 다양한 지역 테스트', () => {
  // 2023.01 해제 이후 모든 지역이 normal
  const regions = [
    ['서울', '강남구'], ['서울', '송파구'], ['서울', '용산구'],
    ['경기', '과천시'], ['경기', '성남시'], ['경기', '하남시'],
    ['부산', '해운대구'], ['대구', '수성구'], ['세종', ''],
    ['인천', '연수구'], ['대전', '유성구'], ['광주', '광산구'],
  ];
  regions.forEach(([region, gu]) => {
    it(`${region} ${gu} → normal`, () => {
      expect(getZone(region, gu)).toBe('normal');
    });
  });
});
