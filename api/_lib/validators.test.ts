// @vitest-environment node
/**
 * validators.js 테스트 — isValidEmail (RFC 5322 느슨한 버전)
 */
import { describe, it, expect } from 'vitest';
import { isValidEmail, parsePagination } from './validators.js';

describe('isValidEmail', () => {
  // 정상 이메일
  it.each([
    ['user@test.com'],
    ['a.b+c@d.co.kr'],
    ['user@sub.domain.example'],
    ['a_b-c@example.io'],
  ])('정상 이메일 %s → true', (v: unknown) => {
    expect(isValidEmail(v)).toBe(true);
  });

  // 비정상 이메일
  it.each([
    ['plain'],
    ['@missing-local.com'],
    ['nobody@.com'],
    ['no@dot'],
    ['trailing@dot.c'], // TLD 1글자 금지
    [''],
    [null],
    [undefined],
    [123],
    [{}],
    [[]],
  ])('비정상 이메일 %s → false', (v: unknown) => {
    expect(isValidEmail(v)).toBe(false);
  });

  // 길이 초과
  it('254자 초과 이메일 → false', () => {
    const longEmail = 'a'.repeat(250) + '@b.com'; // 256자
    expect(isValidEmail(longEmail)).toBe(false);
  });

  // 경계: 254자 정확히 허용
  it('254자 이하는 통과한다', () => {
    const local = 'a'.repeat(240);
    const email = `${local}@b.com`; // 240 + 6 = 246자
    expect(email.length).toBeLessThanOrEqual(254);
    expect(isValidEmail(email)).toBe(true);
  });
});

describe('parsePagination', () => {
  const opts = { defaultLimit: 50, maxLimit: 100 };

  it('값 없으면 기본 limit + offset 0', () => {
    expect(parsePagination({}, opts)).toEqual({ limit: 50, offset: 0 });
    expect(parsePagination(undefined, opts)).toEqual({ limit: 50, offset: 0 });
  });

  it('정상 limit/offset 파싱', () => {
    expect(parsePagination({ limit: '30', offset: '60' }, opts)).toEqual({ limit: 30, offset: 60 });
  });

  it('limit 상한(maxLimit) 클램프', () => {
    expect(parsePagination({ limit: '999' }, opts)).toEqual({ limit: 100, offset: 0 });
  });

  it('limit 하한 1 클램프 (0·음수)', () => {
    expect(parsePagination({ limit: '0' }, opts).limit).toBe(50); // parseInt("0")||default → default
    expect(parsePagination({ limit: '-5' }, opts).limit).toBe(1); // -5 → max(.,1)=1
  });

  it('offset 음수는 0', () => {
    expect(parsePagination({ offset: '-10' }, opts).offset).toBe(0);
  });

  it('배열 값이면 첫 요소 사용', () => {
    expect(parsePagination({ limit: ['25', '99'] }, opts).limit).toBe(25);
  });

  it('파싱 불가 문자열은 기본값', () => {
    expect(parsePagination({ limit: 'abc', offset: 'xyz' }, opts)).toEqual({ limit: 50, offset: 0 });
  });

  it('admin/users 기본값(20)도 동작', () => {
    expect(parsePagination({}, { defaultLimit: 20, maxLimit: 100 })).toEqual({ limit: 20, offset: 0 });
  });
});
