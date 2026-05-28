// @vitest-environment node
/**
 * validators.js 테스트 — isValidEmail (RFC 5322 느슨한 버전)
 */
import { describe, it, expect } from 'vitest';
import { isValidEmail } from './validators.js';

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
