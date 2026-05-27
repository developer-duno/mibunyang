// @vitest-environment node
/**
 * auth/logout.ts 테스트 — 정상 로그아웃, 빈 토큰, 만료 토큰, 멱등성
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

// redis.js 모킹 (tokenBlacklist 내부에서 사용)
const mockKv = { set: vi.fn(), get: vi.fn() };
vi.mock('../_lib/redis.js', () => ({ kv: mockKv }));

const { default: handler } = await import('./logout.js');
const { createToken } = await import('../_lib/auth.js');

/** res 목 객체 팩토리 — handler.ts ResLike 와 호환 (any cast 로 vi.fn 체이닝 흡수) */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as any;
}

describe('auth/logout handler', () => {
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

  // 에러: 토큰이 문자열이 아님
  it('토큰이 문자열이 아니면 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { token: 123 }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 정상: 유효한 토큰 로그아웃
  it('유효한 토큰 로그아웃 시 블랙리스트에 등록하고 ok: true를 반환한다', async () => {
    const token = createToken({ email: 'user@test.com', role: 'admin' }, { ttl: 3600000 });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(mockKv.set).toHaveBeenCalledWith(
      expect.stringMatching(/^bl:/),
      1,
      expect.objectContaining({ ex: expect.any(Number) }),
    );
  });

  // 멱등성: 이미 만료된 토큰도 ok: true
  it('만료된 토큰도 ok: true를 반환한다 (멱등성)', async () => {
    const token = createToken({ email: 'user@test.com' }, { ttl: -1 });
    const res = makeRes();
    await handler({ method: 'POST', body: { token }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    // 만료 토큰은 블랙리스트에 등록하지 않음
    expect(mockKv.set).not.toHaveBeenCalled();
  });

  // 멱등성: 잘못된 형식 토큰도 ok: true
  it('잘못된 형식 토큰도 ok: true를 반환한다 (멱등성)', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { token: 'invalid.token.string' }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});
