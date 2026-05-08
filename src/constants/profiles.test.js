// @ts-check
import { describe, it, expect } from 'vitest';
import { PROFILES } from './profiles';

// 프로필 구조 및 가중치 무결성 검증
describe('PROFILES 상수', () => {
  const EXPECTED_CATS = ['location', 'product', 'price', 'risk', 'benefit', 'future'];

  it('5개 프로필이 존재한다', () => {
    expect(Object.keys(PROFILES)).toHaveLength(5);
    expect(Object.keys(PROFILES)).toEqual(
      expect.arrayContaining(['live', 'invest', 'newlywed', 'edu', 'retire']),
    );
  });

  Object.entries(PROFILES).forEach(([key, p]) => {
    describe(`${key} 프로필`, () => {
      it('가중치 합계 = 100', () => {
        expect(Object.values(p.w).reduce((a, b) => a + b, 0)).toBe(100);
      });

      it('6개 카테고리 키 존재', () => {
        EXPECTED_CATS.forEach((cat) => {
          expect(p.w).toHaveProperty(cat);
        });
      });

      it('가중치가 모두 0 이상 정수', () => {
        Object.values(p.w).forEach((v) => {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(v)).toBe(true);
        });
      });

      it('name과 desc가 비어있지 않음', () => {
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.desc.length).toBeGreaterThan(0);
      });

      it('예상치 못한 키가 없다', () => {
        Object.keys(p.w).forEach((k) => {
          expect(EXPECTED_CATS).toContain(k);
        });
      });
    });
  });

  it('서로 다른 프로필은 서로 다른 가중치를 가진다', () => {
    const keys = Object.keys(PROFILES);
    const P = /** @type {Record<string, { w: unknown }>} */ (PROFILES);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        expect(P[keys[i]].w).not.toEqual(P[keys[j]].w);
      }
    }
  });
});
