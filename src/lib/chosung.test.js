import { describe, it, expect } from 'vitest';
import { getChosung, matchSearch } from './chosung';

// 한글 초성 추출 테스트
describe('getChosung', () => {
  it('한글 문자열에서 초성을 추출한다', () => {
    expect(getChosung('아파트')).toBe('ㅇㅍㅌ');
    expect(getChosung('서울시')).toBe('ㅅㅇㅅ');
  });

  it('영문/숫자는 그대로 반환한다', () => {
    expect(getChosung('ABC123')).toBe('ABC123');
  });

  it('혼합 문자열도 처리한다', () => {
    expect(getChosung('힐스테이트 2차')).toBe('ㅎㅅㅌㅇㅌ 2ㅊ');
  });
});

// 검색 매칭 테스트
describe('matchSearch', () => {
  it('빈 쿼리는 항상 true', () => {
    expect(matchSearch('아파트', '')).toBe(true);
    expect(matchSearch('아파트', null)).toBe(true);
  });

  it('부분 문자열 매칭', () => {
    expect(matchSearch('힐스테이트 강남', '강남')).toBe(true);
    expect(matchSearch('힐스테이트 강남', '부산')).toBe(false);
  });

  it('대소문자 무시', () => {
    expect(matchSearch('GS건설', 'gs')).toBe(true);
  });

  it('초성 검색', () => {
    expect(matchSearch('힐스테이트', 'ㅎㅅ')).toBe(true);
    expect(matchSearch('롯데캐슬', 'ㄹㄷ')).toBe(true);
    expect(matchSearch('힐스테이트', 'ㄹㄷ')).toBe(false);
  });
});

// --- 추가 테스트 ---

describe('getChosung — 특수문자/영숫자/빈문자열/긴문자열', () => {
  it('특수문자 입력 → 그대로 반환', () => {
    expect(getChosung('!@#$%^&*()')).toBe('!@#$%^&*()');
    expect(getChosung('아파트-1차')).toBe('ㅇㅍㅌ-1ㅊ');
  });

  it('영숫자 혼합 → 영숫자는 그대로', () => {
    expect(getChosung('ABC아파트123')).toBe('ABCㅇㅍㅌ123');
    expect(getChosung('SK뷰')).toBe('SKㅂ');
  });

  it('빈 문자열 → 빈 문자열', () => {
    expect(getChosung('')).toBe('');
  });

  it('매우 긴 문자열 (100자) → 에러 없이 처리', () => {
    const longStr = '아'.repeat(100);
    const result = getChosung(longStr);
    expect(result).toBe('ㅇ'.repeat(100));
    expect(result).toHaveLength(100);
  });

  it('공백 포함 문자열', () => {
    expect(getChosung('힐 스 테 이 트')).toBe('ㅎ ㅅ ㅌ ㅇ ㅌ');
  });
});

describe('matchSearch — 추가 케이스', () => {
  it('undefined 쿼리는 항상 true', () => {
    expect(matchSearch('아파트', undefined)).toBe(true);
  });

  it('초성이 아닌 한글 자모 혼합 → 부분 문자열 매칭', () => {
    // 'ㅎ스' 는 순수 초성이 아니므로 부분 문자열 매칭 시도
    expect(matchSearch('힐스테이트', 'ㅎ스')).toBe(false);
  });

  it('숫자만으로 검색', () => {
    expect(matchSearch('힐스테이트 2차', '2')).toBe(true);
    expect(matchSearch('힐스테이트 2차', '3')).toBe(false);
  });
});
