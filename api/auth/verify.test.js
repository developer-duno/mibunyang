// @vitest-environment node
/**
 * auth/verify.js 테스트 — 토큰 유효/만료, 사용자 삭제 403, KV 에러 500
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

// @vercel/kv 모킹
const mockKv = { get: vi.fn() };
vi.mock('@vercel/kv', () => ({ kv: mockKv }));

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
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'approved' });
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
    mockKv.get.mockResolvedValue(null);
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'revoked' }));
  });

  // 에러: pending 상태 → 403
  it('pending 상태 사용자는 403을 반환한다', async () => {
    const token = createToken({ email: 'pending@test.com', name: 'Pend' });
    mockKv.get.mockResolvedValue({ email: 'pending@test.com', status: 'pending' });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // 에러: rejected 상태 → 403
  it('rejected 상태 사용자는 403을 반환한다', async () => {
    const token = createToken({ email: 'rej@test.com', name: 'Rej' });
    mockKv.get.mockResolvedValue({ email: 'rej@test.com', status: 'rejected' });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // 에러: KV 에러 → 500
  it('KV 에러 시 500을 반환한다', async () => {
    const token = createToken({ email: 'user@test.com', name: 'Test' });
    mockKv.get.mockRejectedValue(new Error('KV down'));
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'db_error' }));
  });

  // 정상: admin role 포함
  it('admin role이 있는 토큰은 role을 포함하여 반환한다', async () => {
    const token = createToken({ email: 'admin@test.com', name: 'Admin', role: 'admin' });
    mockKv.get.mockResolvedValue({ email: 'admin@test.com', status: 'approved' });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
  });

  // 에러: 429 레이트 리밋
  it('레이트 리밋 초과 시 429를 반환한다', async () => {
    checkRateLimit.mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();
    await handler({ method: 'POST', body: { token: 'anything' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
