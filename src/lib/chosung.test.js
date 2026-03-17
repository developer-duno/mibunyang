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
