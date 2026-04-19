// @vitest-environment node
/**
 * auth/verify.js 테스트 — 토큰 유효/만료, 블랙리스트, suspended, 사용자 삭제 403, KV 에러 500
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-key-for-auth';
  vi.clearAllMocks();
});

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// @vercel/kv 모킹 (verify.js 가 @vercel/kv 직접 import 유지 — 세션129 이월)
// ../_lib/redis.js 모킹 (tokenBlacklist 가 세션128 에서 새 경로로 import)
// 두 팩토리가 동일 mockKv 인스턴스 반환 → kv.get 호출 순서가 단일 큐로 공유
const mockKv = { get: vi.fn(), set: vi.fn() };
vi.mock('@vercel/kv', () => ({ kv: mockKv }));
vi.mock('../_lib/redis.js', () => ({ kv: mockKv }));

const { default: handler } = await import('./verify.js');
const { createToken } = await import('../_lib/auth.js');
const { checkRateLimit } = await import('../_lib/rateLimit.js');

/** res 목 객체 팩토리 */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
}

/**
 * 유효 토큰 테스트용 KV 모킹 헬퍼
 * isBlacklisted → kv.get(bl:*) = null, user 조회 → kv.get(user:*) = userData
 */
function mockBlacklistThenUser(userData) {
  mockKv.get.mockResolvedValueOnce(null);   // isBlacklisted → false
  mockKv.get.mockResolvedValueOnce(userData); // user 조회
}

describe('auth/verify handler', () => {
  // 에러: POST 이외 메서드
  it('POST가 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: 토큰 없음
  it('토큰 없이 요청 시 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 유효하지 않은 토큰
  it('유효하지 않은 토큰은 401을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { token: 'invalid.token.here' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // 에러: 만료된 토큰
  it('만료된 토큰은 401을 반환한다', async () => {
    const token = createToken({ email: 'user@test.com', name: 'Test' }, { ttl: -1 });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // 정상: 유효한 토큰 + 승인된 사용자
  it('유효한 토큰과 승인된 사용자에 대해 ok: true를 반환한다', async () => {
    const token = createToken({ email: 'user@test.com', name: 'Test' });
    mockBlacklistThenUser({ email: 'user@test.com', status: 'approved' });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      user: { email: 'user@test.com', name: 'Test' },
    }));
  });

  // 에러: 사용자 삭제됨 → 403
  it('삭제된 사용자는 403을 반환한다', async () => {
    const token = createToken({ email: 'deleted@test.com', name: 'Del' });
    mockBlacklistThenUser(null);
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'revoked' }));
  });

  // 에러: pending 상태 → 403
  it('pending 상태 사용자는 403을 반환한다', async () => {
    const token = createToken({ email: 'pending@test.com', name: 'Pend' });
    mockBlacklistThenUser({ email: 'pending@test.com', status: 'pending' });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // 에러: rejected 상태 → 403
  it('rejected 상태 사용자는 403을 반환한다', async () => {
    const token = createToken({ email: 'rej@test.com', name: 'Rej' });
    mockBlacklistThenUser({ email: 'rej@test.com', status: 'rejected' });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // 에러: KV 에러 → 500
  it('KV 에러 시 500을 반환한다', async () => {
    const token = createToken({ email: 'user@test.com', name: 'Test' });
    mockKv.get.mockResolvedValueOnce(null); // isBlacklisted → false
    mockKv.get.mockRejectedValueOnce(new Error('KV down')); // user 조회 실패
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'db_error' }));
  });

  // 정상: admin role 포함
  it('admin role이 있는 토큰은 role을 포함하여 반환한다', async () => {
    const token = createToken({ email: 'admin@test.com', name: 'Admin', role: 'admin' });
    mockBlacklistThenUser({ email: 'admin@test.com', status: 'approved' });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
  });

  // 블랙리스트: 로그아웃된 토큰 거부
  it('블랙리스트된 토큰은 401을 반환한다', async () => {
    const token = createToken({ email: 'user@test.com', name: 'Test' });
    mockKv.get.mockResolvedValueOnce(1); // isBlacklisted → true
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: '로그아웃된 토큰입니다' }));
  });

  // suspended 상태 사용자 → 403
  it('suspended 상태 사용자는 403을 반환한다', async () => {
    const token = createToken({ email: 'sus@test.com', name: 'Sus' });
    mockBlacklistThenUser({ email: 'sus@test.com', status: 'suspended' });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // 에러: 429 레이트 리밋
  it('레이트 리밋 초과 시 429를 반환한다', async () => {
    checkRateLimit.mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();
    await handler({ method: 'POST', body: { token: 'anything' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
