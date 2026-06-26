// @ts-check
import { describe, it, expect } from 'vitest';
import { fmtPrice, fmtCompletion, maskName, maskPhone, fmtPriceRange, fmtPresaleSchedule, fmtRecruitDate, fmtCompetitionRate, fmtUnsoldRate } from './format';

describe('fmtUnsoldRate — 100% 캡 (세션 444)', () => {
  it('정상 범위는 그대로 표시', () => {
    expect(fmtUnsoldRate(45)).toBe('45%');
    expect(fmtUnsoldRate(0)).toBe('0%');
    expect(fmtUnsoldRate(100)).toBe('100%');
  });
  it('100% 초과는 "100%+" 로 캡 (units 잔여공급분 오류 방어)', () => {
    expect(fmtUnsoldRate(818.2)).toBe('100%+');
    expect(fmtUnsoldRate(7100)).toBe('100%+');
    expect(fmtUnsoldRate(101)).toBe('100%+');
  });
  it('null/undefined 는 "-"', () => {
    expect(fmtUnsoldRate(null)).toBe('-');
    expect(fmtUnsoldRate(undefined)).toBe('-');
  });
});

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
    expect(fmtCompletion(/** @type {string} */ (/** @type {unknown} */ (0)))).toBe('-');
  });
});

// --- 이름 마스킹 테스트 ---
describe('maskName', () => {
  it('정상: 3자 이름 → 첫글자 + **', () => {
    expect(maskName("홍길동")).toBe("홍**");
  });
  it('2자 이름', () => {
    expect(maskName("이준")).toBe("이*");
  });
  it('1자 이름', () => {
    expect(maskName("김")).toBe("김");
  });
  it('null/undefined → 빈 문자열', () => {
    expect(maskName(null)).toBe("");
    expect(maskName(undefined)).toBe("");
  });
  it('빈 문자열 → 빈 문자열', () => {
    expect(maskName("")).toBe("");
  });
  it('숫자 등 비문자열 → 빈 문자열', () => {
    expect(maskName(/** @type {string} */ (/** @type {unknown} */ (123)))).toBe("");
  });
});

// --- 전화번호 마스킹 테스트 ---
describe('maskPhone', () => {
  it('정상: 하이픈 포함', () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
  });
  it('하이픈 없이', () => {
    expect(maskPhone("01012345678")).toBe("010-****-5678");
  });
  it('8자리 이하 → 원본 반환', () => {
    expect(maskPhone("1234567")).toBe("1234567");
  });
  it('null/undefined → 빈 문자열', () => {
    expect(maskPhone(null)).toBe("");
    expect(maskPhone(undefined)).toBe("");
  });
});

// --- 분양가 범위 포맷팅 테스트 ---
describe('fmtPriceRange', () => {
  it('min~max 범위 포맷', () => {
    expect(fmtPriceRange(30000, 50000)).toBe('3억 ~ 5억');
  });
  it('min == max → 단일 값', () => {
    expect(fmtPriceRange(30000, 30000)).toBe('3억');
  });
  it('both null → "—"', () => {
    expect(fmtPriceRange(null, null)).toBe('—');
  });
  it('min만 있고 max null → "3억 ~ ?"', () => {
    expect(fmtPriceRange(30000, null)).toBe('3억 ~ ?');
  });
});

// --- 분양일정 JSONB 포맷팅 테스트 ---
describe('fmtPresaleSchedule', () => {
  it('JSONB 객체 → 문자열', () => {
    const schedule = { scheduleName: "입주자모집공고", dateInfo: "2026-03-01" };
    expect(fmtPresaleSchedule(schedule)).toContain("입주자모집공고");
  });
  it('배열 → 콤마 조인', () => {
    const arr = [{ scheduleName: "공고", dateInfo: "3/1" }, { scheduleName: "청약", dateInfo: "3/5" }];
    const result = fmtPresaleSchedule(arr);
    expect(result).toContain("공고");
    expect(result).toContain("청약");
  });
  it('null → "—"', () => {
    expect(fmtPresaleSchedule(null)).toBe("—");
  });
  it('빈 배열 → "—"', () => {
    expect(fmtPresaleSchedule([])).toBe("—");
  });
  it('잘못된 JSONB (빈 객체) → "—"', () => {
    expect(fmtPresaleSchedule({})).toBe("—");
  });
});

// --- 분양시기 포맷팅 테스트 ---
describe('fmtRecruitDate', () => {
  it('"2026-03-01" → 날짜 포맷', () => {
    expect(fmtRecruitDate("2026-03-01")).toBe("2026.03.01");
  });
  it('null → "—"', () => {
    expect(fmtRecruitDate(null)).toBe("—");
  });
});

// --- 청약 경쟁률 포맷팅 테스트 ---
describe('fmtCompetitionRate', () => {
  it('극단값 1000:1↑ → 정수 + 천단위 콤마', () => {
    expect(fmtCompetitionRate(437995)).toBe("437,995:1");
    expect(fmtCompetitionRate(1000)).toBe("1,000:1");
  });
  it('1000 미만 → 소수 1자리', () => {
    expect(fmtCompetitionRate(5.2)).toBe("5.2:1");
    expect(fmtCompetitionRate(8.58)).toBe("8.6:1");
    expect(fmtCompetitionRate(999.9)).toBe("999.9:1");
  });
  it('0 → "0.0:1"', () => {
    expect(fmtCompetitionRate(0)).toBe("0.0:1");
  });
  it('음수 → "미달 N%"', () => {
    expect(fmtCompetitionRate(-0.3)).toBe("미달 30%");
    expect(fmtCompetitionRate(-1)).toBe("미달 100%");
  });
  it('null/undefined → "미수집"', () => {
    expect(fmtCompetitionRate(null)).toBe("미수집");
    expect(fmtCompetitionRate(undefined)).toBe("미수집");
  });
});
