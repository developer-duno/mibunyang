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

// --- 추가 테스트 ---

describe('fmtPrice — 큰 숫자', () => {
  it('100000 → "10억"', () => {
    expect(fmtPrice(100000)).toBe('10억');
  });
  it('150000 → "15억"', () => {
    expect(fmtPrice(150000)).toBe('15억');
  });
  it('105000 → "10억 5,000만"', () => {
    expect(fmtPrice(105000)).toBe('10억 5,000만');
  });
  it('200001 → "20억 1만"', () => {
    expect(fmtPrice(200001)).toBe('20억 1만');
  });
});

describe('fmtPrice — 음수, NaN, Infinity', () => {
  it('음수 → -', () => {
    expect(fmtPrice(-1)).toBe('-');
    expect(fmtPrice(-50000)).toBe('-');
  });
  it('NaN → fmtPrice가 에러 없이 처리', () => {
    // NaN은 v == null과 v <= 0 모두 false이므로 로직 진입
    // 실제 동작: 'NaN만' 반환 (NaN % 10000 = NaN, toLocaleString = 'NaN')
    expect(() => fmtPrice(NaN)).not.toThrow();
  });
  it('Infinity → 처리 (NaN/null이 아니므로 출력)', () => {
    // Infinity > 0이므로 fmtPrice 로직 진입
    // Math.floor(Infinity / 10000) = Infinity, Infinity % 10000 = NaN
    // 실제 동작 확인 (에러 없이 반환되기만 하면 됨)
    expect(() => fmtPrice(Infinity)).not.toThrow();
  });
  it('undefined → -', () => {
    expect(fmtPrice(undefined)).toBe('-');
  });
});

describe('fmtCompletion — 추가 edge cases', () => {
  it('6자리 정확히: 202512 → "2025년 12월"', () => {
    expect(fmtCompletion('202512')).toBe('2025년 12월');
  });
  it('7자리 이상도 앞 6자리만 파싱', () => {
    expect(fmtCompletion('2025061')).toBe('2025년 06월');
  });
  it('YYYY-MM-DD 형식은 앞 4자리/4~6자리 사용', () => {
    expect(fmtCompletion('2025-06-01')).toBe('2025년 -0월');
    // 이 형식은 의도된 사용이 아니지만 에러 없이 처리됨
  });
  it('숫자 0 → -', () => {
    expect(fmtCompletion(0)).toBe('-');
  });
});
