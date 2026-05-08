// @ts-check
// @vitest-environment node
/**
 * auth/signup.js 테스트 — 필드 검증, 이메일 중복 409, 롤백 처리
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

// auth 모킹
vi.mock('../_lib/auth.js', () => ({
  hashPassword: vi.fn().mockReturnValue({ hash: 'hashed', salt: 'salted' }),
}));

// redis.js 모킹
const mockKv = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  sadd: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
};
vi.mock('../_lib/redis.js', () => ({ kv: mockKv }));

const { default: handler } = await import('./signup.js');
const { checkRateLimit } = await import('../_lib/rateLimit.js');

/** res 목 객체 팩토리 */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    end: vi.fn(),
  };
}

/** 유효한 가입 body 팩토리 */
function makeValidBody(overrides = {}) {
  return {
    email: 'new@test.com',
    password: 'password123',
    name: '홍길동',
    affiliation: '테스트회사',
    phone: '010-1234-5678',
    specialty: '부동산 중개',
    license: '자격증',
    experience: 5,
    bio: '안녕하세요 테스트 자기소개입니다',
    ...overrides,
  };
}

/** req 목 객체 팩토리 */
function makeReq(body = {}) {
  return { method: 'POST', body, headers: { origin: 'http://localhost:3000' } };
}

describe('auth/signup handler', () => {
  // 에러: POST 이외 메서드
  it('POST가 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 정상: OPTIONS preflight
  it('OPTIONS preflight는 204를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } }, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'POST, OPTIONS');
  });

  // 에러: 429 레이트 리밋
  it('레이트 리밋 초과 시 429를 반환한다', async () => {
    /** @type {any} */ (checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();
    await handler(makeReq(makeValidBody()), res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  // 에러: 필수 필드 누락
  it('이메일/패스워드/이름 누락 시 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: '12345678' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 잘못된 이메일 형식
  it('잘못된 이메일 형식은 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq(makeValidBody({ email: 'invalid' })), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 패스워드 8자 미만
  it('8자 미만 패스워드는 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq(makeValidBody({ password: '1234567' })), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 128자 초과 패스워드
  it('128자 초과 패스워드는 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq(makeValidBody({ password: 'x'.repeat(129) })), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 잘못된 전화번호 형식
  it('잘못된 전화번호 형식은 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq(makeValidBody({ phone: '02-1234-5678' })), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 잘못된 전문 분야
  it('유효하지 않은 전문 분야는 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq(makeValidBody({ specialty: '요리' })), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 경력 범위 초과
  it('경력 50년 초과는 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq(makeValidBody({ experience: 51 })), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 자기소개 10자 미만
  it('자기소개 10자 미만은 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq(makeValidBody({ bio: '짧음' })), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 이메일 중복 409
  it('이미 등록된 이메일은 409를 반환한다', async () => {
    mockKv.get.mockResolvedValueOnce({ email: 'existing@test.com' });
    const res = makeRes();
    await handler(makeReq(makeValidBody()), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  // 정상: 가입 성공
  it('정상 가입 시 ok: true를 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq(makeValidBody()), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(mockKv.set).toHaveBeenCalled();
    expect(mockKv.sadd).toHaveBeenCalledWith('users:pending', 'new@test.com');
  });

  // 에러: sadd 실패 시 롤백 (kv.del 호출)
  it('sadd 실패 시 사용자 데이터를 롤백한다', async () => {
    mockKv.sadd.mockRejectedValueOnce(new Error('Redis error'));
    const res = makeRes();
    await handler(makeReq(makeValidBody()), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockKv.del).toHaveBeenCalledWith('user:new@test.com');
  });

  // 에러: 이름 50자 초과
  it('이름 50자 초과는 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq(makeValidBody({ name: 'x'.repeat(51) })), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
