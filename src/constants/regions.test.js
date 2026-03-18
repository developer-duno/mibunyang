import { describe, it, expect } from 'vitest';
import { CITY_TIER, REGIONS } from './regions';

describe('CITY_TIER', () => {
  const TIERS = Object.keys(CITY_TIER);

  it('S, A, B, C, D 5개 등급 존재', () => {
    expect(TIERS).toEqual(expect.arrayContaining(['S', 'A', 'B', 'C', 'D']));
    expect(TIERS).toHaveLength(5);
  });

  Object.entries(CITY_TIER).forEach(([tier, info]) => {
    it(`${tier} 등급: 4개 교통 가중치 모두 0~1 범위`, () => {
      ['subwayW', 'busW', 'icW', 'ktxW'].forEach((k) => {
        expect(info[k]).toBeGreaterThanOrEqual(0);
        expect(info[k]).toBeLessThanOrEqual(1);
      });
    });

    it(`${tier} 등급: label 존재`, () => {
      expect(info.label.length).toBeGreaterThan(0);
    });
  });

  it('S등급(서울)은 subwayW=1.0 (최고)', () => {
    expect(CITY_TIER.S.subwayW).toBe(1.0);
  });

  it('D등급(군)은 subwayW가 가장 낮다', () => {
    TIERS.forEach((t) => {
      expect(CITY_TIER.D.subwayW).toBeLessThanOrEqual(CITY_TIER[t].subwayW);
    });
  });
});

describe('REGIONS', () => {
  it('17개 시도 존재', () => {
    expect(Object.keys(REGIONS)).toHaveLength(17);
  });

  it('필수 시도 포함', () => {
    ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기",
     "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"].forEach((r) => {
      expect(REGIONS).toHaveProperty(r);
    });
  });

  Object.entries(REGIONS).forEach(([name, info]) => {
    it(`${name}: tier 참조가 CITY_TIER에 존재`, () => {
      expect(CITY_TIER).toHaveProperty(info.tier);
    });

    it(`${name}: gus 배열이 비어있지 않음`, () => {
      expect(info.gus.length).toBeGreaterThan(0);
    });

    it(`${name}: 중복 구/군 없음`, () => {
      const unique = new Set(info.gus);
      expect(unique.size).toBe(info.gus.length);
    });
  });

  it('서울 = S등급', () => { expect(REGIONS["서울"].tier).toBe("S"); });
  it('서울 25개 구', () => { expect(REGIONS["서울"].gus).toHaveLength(25); });
  it('경기 = B등급', () => { expect(REGIONS["경기"].tier).toBe("B"); });
  it('제주 = C등급', () => { expect(REGIONS["제주"].tier).toBe("C"); });
});
