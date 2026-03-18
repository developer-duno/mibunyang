// @vitest-environment node
/**
 * adminAuth.js 테스트 — Bearer 파싱, role 체크, 잘못된 토큰 처리
 */
import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-key-for-auth';
});

const { verifyAdminToken } = await import('./adminAuth.js');
const { createToken } = await import('./auth.js');

/** req 목 객체 팩토리 */
function makeReq(authHeader) {
  return { headers: { authorization: authHeader } };
}

describe('verifyAdminToken', () => {
  // 정상: admin role 토큰 검증
  it('admin role 토큰을 검증하고 payload를 반환한다', () => {
    const token = createToken({ email: 'admin@test.com', role: 'admin' });
    const result = verifyAdminToken(makeReq(`Bearer ${token}`));
    expect(result).not.toBeNull();
    expect(result.email).toBe('admin@test.com');
    expect(result.role).toBe('admin');
  });

  // 에러: role이 admin이 아닌 토큰
  it('admin이 아닌 role 토큰은 null을 반환한다', () => {
    const token = createToken({ email: 'user@test.com', role: 'user' });
    expect(verifyAdminToken(makeReq(`Bearer ${token}`))).toBeNull();
  });

  // 에러: role 없는 토큰
  it('role이 없는 토큰은 null을 반환한다', () => {
    const token = createToken({ email: 'user@test.com' });
    expect(verifyAdminToken(makeReq(`Bearer ${token}`))).toBeNull();
  });

  // 에러: Bearer 접두사 없음
  it('Bearer 접두사가 없으면 null을 반환한다', () => {
    const token = createToken({ email: 'admin@test.com', role: 'admin' });
    expect(verifyAdminToken(makeReq(token))).toBeNull();
    expect(verifyAdminToken(makeReq(`Token ${token}`))).toBeNull();
  });

  // 에러: authorization 헤더 없음
  it('authorization 헤더가 없으면 null을 반환한다', () => {
    expect(verifyAdminToken({ headers: {} })).toBeNull();
    expect(verifyAdminToken({ headers: { authorization: undefined } })).toBeNull();
  });

  // 에러: 잘못된 토큰 문자열
  it('잘못된 토큰 문자열은 null을 반환한다', () => {
    expect(verifyAdminToken(makeReq('Bearer invalid-token'))).toBeNull();
    expect(verifyAdminToken(makeReq('Bearer '))).toBeNull();
  });
});
