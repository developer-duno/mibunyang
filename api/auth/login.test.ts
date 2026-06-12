// @vitest-environment node
/**
 * auth/login.ts 테스트 — 인증 플로우, 429, 이메일 형식, PENDING/REJECTED 상태
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// 환경변수 설정
beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-key-for-auth';
  delete process.env.ADMIN_EMAIL;
  vi.clearAllMocks();
});

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// redis.js 모킹
const mockKv = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue('OK'),
};
vi.mock('../_lib/redis.js', () => ({
  kv: mockKv,
}));

const { default: handler } = await import('./login.js');
const { checkRateLimit } = await import('../_lib/rateLimit.js');
const { hashPassword, verifyToken } = await import('../_lib/auth.js');

/** res 목 객체 팩토리 — ResLike 호환 (any cast 로 vi.fn 체이닝 흡수) */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as any;
}

/** req 목 객체 팩토리 */
function makeReq(body: any = {}) {
  return { method: 'POST', body, headers: {} };
}

/** 테스트 사용자 데이터 팩토리 */
function makeUser(overrides: Record<string, any> = {}) {
  const { hash, salt } = hashPassword('validPass123');
  return {
    email: 'test@example.com',
    name: 'Test User',
    affiliation: 'Test Corp',
    passwordHash: hash,
    salt,
    status: 'approved',
    ...overrides,
  };
}

describe('auth/login handler', () => {
  // 에러: POST 이외 메서드
  it('POST가 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: 429 레이트 리밋
  it('레이트 리밋 초과 시 429를 반환한다', async () => {
    (checkRateLimit as any).mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: '12345678' }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '300');
  });

  // 에러: 빈 이메일/패스워드
  it('이메일/패스워드 미입력 시 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 잘못된 이메일 형식
  it('잘못된 이메일 형식은 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ email: 'not-an-email', password: '12345678' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 패스워드 길이 제한
  it('8자 미만 패스워드는 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ email: 'test@test.com', password: '1234567' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 존재하지 않는 사용자
  it('존재하지 않는 사용자는 401을 반환한다', async () => {
    mockKv.get.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq({ email: 'noone@test.com', password: '12345678' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // 에러: 잘못된 비밀번호
  it('잘못된 비밀번호는 401을 반환한다', async () => {
    mockKv.get.mockResolvedValue(makeUser());
    const res = makeRes();
    await handler(makeReq({ email: 'test@example.com', password: 'wrongPass1' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // 정상: 관리자 로그인 성공 (세션 405 — 비밀번호 로그인은 관리자 전용)
  it('관리자 로그인 시 토큰과 사용자 정보를 반환한다', async () => {
    process.env.ADMIN_EMAIL = 'test@example.com';
    mockKv.get.mockResolvedValue(makeUser());
    const res = makeRes();
    await handler(makeReq({ email: 'test@example.com', password: 'validPass123' }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      token: expect.any(String),
      role: 'admin',
      user: expect.objectContaining({ email: 'test@example.com' }),
    }));
  });

  // 세션 405: 비admin 계정(레거시 전문가 가입 포함) = generic 401 (계정 존재 비노출)
  it('비admin 계정은 올바른 비밀번호여도 generic 401을 반환한다', async () => {
    mockKv.get.mockResolvedValue(makeUser());
    const res = makeRes();
    await handler(makeReq({ email: 'test@example.com', password: 'validPass123' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      error: '이메일 또는 비밀번호가 일치하지 않습니다',
    }));
  });

  it('레거시 pending/rejected 계정도 statusCode 노출 없이 401', async () => {
    for (const status of ['pending', 'rejected']) {
      vi.clearAllMocks();
      mockKv.get.mockResolvedValue(makeUser({ status }));
      const res = makeRes();
      await handler(makeReq({ email: 'test@example.com', password: 'validPass123' }), res);
      expect(res.status).toHaveBeenCalledWith(401);
      const body = res.json.mock.calls[0][0];
      expect(body.statusCode).toBeUndefined();
    }
  });

  // 정상: 레거시 SHA-256 → PBKDF2 자동 마이그레이션 (admin 계정 기준 — 비admin 은 이후 401)
  it('레거시 SHA-256 해시 관리자의 비밀번호를 PBKDF2로 업그레이드한다', async () => {
    process.env.ADMIN_EMAIL = 'test@example.com';
    const salt = 'legacy-test-salt';
    const password = 'validPass123';
    const legacyHash = crypto.createHash('sha256').update(salt + password).digest('hex');
    mockKv.get.mockResolvedValue(makeUser({ passwordHash: legacyHash, salt }));
    const res = makeRes();
    await handler(makeReq({ email: 'test@example.com', password }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    // kv.set이 호출되어 PBKDF2로 업그레이드
    expect(mockKv.set).toHaveBeenCalled();
    const updatedUser = mockKv.set.mock.calls[0][1] as any;
    expect(updatedUser.passwordHash).toHaveLength(128); // PBKDF2
  });

  // 정상: admin 이메일인 경우 role=admin 포함
  it('admin 이메일인 경우 role=admin이 포함된다', async () => {
    process.env.ADMIN_EMAIL = 'admin@test.com';
    mockKv.get.mockResolvedValue(makeUser({ email: 'admin@test.com' }));
    const res = makeRes();
    await handler(makeReq({ email: 'admin@test.com', password: 'validPass123' }), res);
    const response = res.json.mock.calls[0][0];
    expect(response).toEqual(expect.objectContaining({
      ok: true,
      role: 'admin',
    }));
    expect(verifyToken(response.token)).toEqual(expect.objectContaining({ role: 'admin' }));
  });

  // KV 에러 시 500
  it('KV 에러 시 500을 반환한다', async () => {
    mockKv.get.mockRejectedValue(new Error('KV down'));
    const res = makeRes();
    await handler(makeReq({ email: 'test@example.com', password: '12345678' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
