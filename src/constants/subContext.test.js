import { describe, it, expect } from 'vitest';
import { SUB_CONTEXT, PRODUCT_MAX } from './subContext';

describe('SUB_CONTEXT', () => {
  const EXPECTED_CATS = ['price', 'location', 'product', 'benefit', 'risk', 'future'];

  it('6개 카테고리 존재', () => {
    EXPECTED_CATS.forEach((cat) => {
      expect(SUB_CONTEXT).toHaveProperty(cat);
    });
  });

  // interpret 함수 null 안전성 검증
  Object.entries(SUB_CONTEXT).forEach(([cat, subs]) => {
    Object.entries(subs).forEach(([name, ctx]) => {
      if (ctx.interpret === null) return; // benefit은 null

      it(`${cat}.${name}: interpret(null) 에러 없이 동작`, () => {
        expect(() => ctx.interpret(null)).not.toThrow();
      });

      it(`${cat}.${name}: interpret(0) 에러 없이 동작`, () => {
        expect(() => ctx.interpret(0)).not.toThrow();
      });

      it(`${cat}.${name}: interpret(100) 문자열 반환`, () => {
        expect(typeof ctx.interpret(100)).toBe('string');
      });

      it(`${cat}.${name}: interpret(50) 문자열 반환`, () => {
        expect(typeof ctx.interpret(50)).toBe('string');
      });

      it(`${cat}.${name}: benchmark 문자열 존재`, () => {
        expect(typeof ctx.benchmark).toBe('string');
        expect(ctx.benchmark.length).toBeGreaterThan(0);
      });
    });
  });

  // benefit 카테고리 특수 검증
  it('benefit 서브는 interpret/benchmark 모두 null', () => {
    Object.values(SUB_CONTEXT.benefit).forEach((ctx) => {
      expect(ctx.interpret).toBeNull();
      expect(ctx.benchmark).toBeNull();
    });
  });

  // 카테고리별 서브 수 검증
  it('price: 5개 서브', () => { expect(Object.keys(SUB_CONTEXT.price)).toHaveLength(5); });
  it('location: 5개 서브', () => { expect(Object.keys(SUB_CONTEXT.location)).toHaveLength(5); });
  it('product: 9개 서브', () => { expect(Object.keys(SUB_CONTEXT.product)).toHaveLength(9); });
  it('benefit: 5개 서브', () => { expect(Object.keys(SUB_CONTEXT.benefit)).toHaveLength(5); });
  it('risk: 7개 서브', () => { expect(Object.keys(SUB_CONTEXT.risk)).toHaveLength(7); });

  // interpret 3단계 검증 (높음/보통/낮음)
  it('price.적정가 괴리도: 70→높음, 40→보통, 30→낮음', () => {
    const fn = SUB_CONTEXT.price["적정가 괴리도"].interpret;
    expect(fn(70)).toContain("저렴");
    expect(fn(40)).toContain("적정");
    expect(fn(30)).toContain("비쌈");
  });
});

describe('PRODUCT_MAX', () => {
  it('합계 = 100', () => {
    expect(Object.values(PRODUCT_MAX).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('9개 서브스코어 정의', () => {
    expect(Object.keys(PRODUCT_MAX)).toHaveLength(9);
  });

  it('모든 값이 양수', () => {
    Object.values(PRODUCT_MAX).forEach((v) => expect(v).toBeGreaterThan(0));
  });

  it('브랜드=20 (최대)', () => { expect(PRODUCT_MAX["브랜드"]).toBe(20); });
  it('내진=5, 구조=5 (최소)', () => {
    expect(PRODUCT_MAX["내진"]).toBe(5);
    expect(PRODUCT_MAX["구조"]).toBe(5);
  });

  // SUB_CONTEXT.product 키와 매칭 검증
  it('PRODUCT_MAX 키가 SUB_CONTEXT.product 키와 일치', () => {
    const maxKeys = Object.keys(PRODUCT_MAX).sort();
    const ctxKeys = Object.keys(SUB_CONTEXT.product).sort();
    expect(maxKeys).toEqual(ctxKeys);
  });
});
