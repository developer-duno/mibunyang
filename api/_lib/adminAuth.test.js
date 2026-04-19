// @vitest-environment node
/**
 * adminAuth.js 테스트 — Bearer 파싱, role 체크, 잘못된 토큰 처리, 블랙리스트 토큰 거부
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-key-for-auth';
  vi.clearAllMocks();
});

// ./redis.js 모킹 (tokenBlacklist 내부에서 사용, 세션128: @vercel/kv → ./redis.js)
const mockKv = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
vi.mock('./redis.js', () => ({ kv: mockKv }));

const { verifyAdminToken } = await import('./adminAuth.js');
const { createToken } = await import('./auth.js');

/** req 목 객체 팩토리 */
function makeReq(authHeader) {
  return { headers: { authorization: authHeader } };
}

describe('verifyAdminToken', () => {
  // 정상: admin role 토큰 검증
  it('admin role 토큰을 검증하고 payload를 반환한다', async () => {
    const token = createToken({ email: 'admin@test.com', role: 'admin' });
    const result = await verifyAdminToken(makeReq(`Bearer ${token}`));
    expect(result).not.toBeNull();
    expect(result.email).toBe('admin@test.com');
    expect(result.role).toBe('admin');
  });

  // 에러: role이 admin이 아닌 토큰
  it('admin이 아닌 role 토큰은 null을 반환한다', async () => {
    const token = createToken({ email: 'user@test.com', role: 'user' });
    expect(await verifyAdminToken(makeReq(`Bearer ${token}`))).toBeNull();
  });

  // 에러: role 없는 토큰
  it('role이 없는 토큰은 null을 반환한다', async () => {
    const token = createToken({ email: 'user@test.com' });
    expect(await verifyAdminToken(makeReq(`Bearer ${token}`))).toBeNull();
  });

  // 에러: Bearer 접두사 없음
  it('Bearer 접두사가 없으면 null을 반환한다', async () => {
    const token = createToken({ email: 'admin@test.com', role: 'admin' });
    expect(await verifyAdminToken(makeReq(token))).toBeNull();
    expect(await verifyAdminToken(makeReq(`Token ${token}`))).toBeNull();
  });

  // 에러: authorization 헤더 없음
  it('authorization 헤더가 없으면 null을 반환한다', async () => {
    expect(await verifyAdminToken({ headers: {} })).toBeNull();
    expect(await verifyAdminToken({ headers: { authorization: undefined } })).toBeNull();
  });

  // 에러: 잘못된 토큰 문자열
  it('잘못된 토큰 문자열은 null을 반환한다', async () => {
    expect(await verifyAdminToken(makeReq('Bearer invalid-token'))).toBeNull();
    expect(await verifyAdminToken(makeReq('Bearer '))).toBeNull();
  });

  // 블랙리스트: 블랙리스트된 admin 토큰 거부
  it('블랙리스트된 admin 토큰은 null을 반환한다', async () => {
    mockKv.get.mockResolvedValueOnce(1); // isBlacklisted → true
    const token = createToken({ email: 'admin@test.com', role: 'admin' });
    expect(await verifyAdminToken(makeReq(`Bearer ${token}`))).toBeNull();
  });

  // Redis 장애: fail-open (블랙리스트 체크 실패 시 통과)
  it('Redis 장애 시 fail-open (토큰 통과)', async () => {
    mockKv.get.mockRejectedValueOnce(new Error('Redis down'));
    const token = createToken({ email: 'admin@test.com', role: 'admin' });
    const result = await verifyAdminToken(makeReq(`Bearer ${token}`));
    expect(result).not.toBeNull();
    expect(result.email).toBe('admin@test.com');
  });
});
