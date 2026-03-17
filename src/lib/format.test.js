import { describe, it, expect } from 'vitest';
import { fmtPrice, fmtCompletion } from './format';

// 가격 포맷팅 테스트
describe('fmtPrice', () => {
  it('억+만 혼합 표시', () => {
    expect(fmtPrice(24675)).toBe('2억 4,675만');
  });

  it('억 단위만', () => {
    expect(fmtPrice(30000)).toBe('3억');
  });

  it('만 단위만', () => {
    expect(fmtPrice(5000)).toBe('5,000만');
  });

  it('null/0/음수는 -', () => {
    expect(fmtPrice(null)).toBe('-');
    expect(fmtPrice(0)).toBe('-');
    expect(fmtPrice(-100)).toBe('-');
  });
});

// 입주일 포맷팅 테스트
describe('fmtCompletion', () => {
  it('YYYYMM을 년월 형식으로 변환', () => {
    expect(fmtCompletion('202501')).toBe('2025년 01월');
  });

  it('null/빈값은 -', () => {
    expect(fmtCompletion(null)).toBe('-');
    expect(fmtCompletion('')).toBe('-');
  });

  it('짧은 문자열은 그대로 반환', () => {
    expect(fmtCompletion('2025')).toBe('2025');
  });
});
