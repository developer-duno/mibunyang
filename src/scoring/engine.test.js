import { describe, it, expect } from 'vitest';
import { PROFILES } from '@/constants/profiles';
import { getAgeCoeff, getAreaAdj } from './engine';

// 가중치 합계 = 100% 검증 (Critical Rule #1)
describe('프로필 가중치 합계', () => {
  Object.entries(PROFILES).forEach(([key, profile]) => {
    it(key + ' 프로필 가중치 합계 = 100', () => {
      const sum = Object.values(profile.w).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    });
  });

  it('프로필이 5개 존재한다', () => {
    expect(Object.keys(PROFILES).length).toBe(5);
  });

  it('모든 프로필에 6개 카테고리가 있다', () => {
    const cats = ['location', 'product', 'price', 'risk', 'benefit', 'future'];
    Object.entries(PROFILES).forEach(([key, profile]) => {
      cats.forEach(cat => {
        expect(profile.w).toHaveProperty(cat);
        expect(typeof profile.w[cat]).toBe('number');
      });
    });
  });
});

// 연식 계수 테스트
describe('getAgeCoeff', () => {
  it('미래 입주일은 1.0', () => {
    expect(getAgeCoeff('2030-01-01')).toBe(1.0);
  });

  it('null은 1.05 (기본값)', () => {
    expect(getAgeCoeff(null)).toBe(1.05);
  });

  it('유효하지 않은 값은 1.05', () => {
    expect(getAgeCoeff('invalid')).toBe(1.05);
  });
});

// 면적 보정 테스트
describe('getAreaAdj', () => {
  it('소형 (60m2 미만) = 1.08', () => {
    expect(getAreaAdj(50)).toBe(1.08);
  });

  it('중형 (60~85m2) = 1.0', () => {
    expect(getAreaAdj(84)).toBe(1.0);
  });

  it('null/0 = 1.0 (중립)', () => {
    expect(getAreaAdj(null)).toBe(1.0);
    expect(getAreaAdj(0)).toBe(1.0);
  });
});
