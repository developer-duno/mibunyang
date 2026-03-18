// @vitest-environment node
/**
 * admin/users.js 테스트 — 상태 필터, 비밀번호 제거, 정렬
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-key-for-auth';
  vi.clearAllMocks();
});

// adminAuth 모킹
vi.mock('../_lib/adminAuth.js', () => ({
  verifyAdminToken: vi.fn().mockReturnValue({ email: 'admin@test.com', role: 'admin' }),
}));

// @vercel/kv 모킹
const mockKv = {
  get: vi.fn(),
  smembers: vi.fn().mockResolvedValue([]),
};
vi.mock('@vercel/kv', () => ({ kv: mockKv }));

const { default: handler } = await import('./users.js');
const { verifyAdminToken } = await import('../_lib/adminAuth.js');

/** res 목 객체 팩토리 */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

/** req 목 객체 팩토리 */
function makeReq(query = {}) {
  return { method: 'GET', query, headers: { authorization: 'Bearer valid' } };
}

/** 테스트 사용자 팩토리 */
function makeUser(email, createdAt, status = 'pending') {
  return {
    email,
    name: email.split('@')[0],
    status,
    createdAt,
    passwordHash: 'secret-hash',
    salt: 'secret-salt',
  };
}

describe('admin/users handler', () => {
  // 에러: GET 이외 메서드
  it('GET이 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: 관리자 인증 실패
  it('관리자 인증 실패 시 401을 반환한다', async () => {
    verifyAdminToken.mockReturnValueOnce(null);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // 에러: 잘못된 상태 필터
  it('잘못된 상태 필터는 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ status: 'invalid' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 정상: 빈 목록
  it('사용자가 없으면 빈 배열을 반환한다', async () => {
    mockKv.smembers.mockResolvedValue([]);
    const res = makeRes();
    await handler(makeReq({ status: 'pending' }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, users: [] });
  });

  // 정상: pending 상태 필터
  it('pending 상태의 사용자 목록을 반환한다', async () => {
    mockKv.smembers.mockResolvedValue(['user1@test.com']);
    mockKv.get.mockResolvedValue(makeUser('user1@test.com', '2025-01-01'));
    const res = makeRes();
    await handler(makeReq({ status: 'pending' }), res);
    const users = res.json.mock.calls[0][0].users;
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('user1@test.com');
  });

  // 정상: password/salt 필드 제거
  it('응답에 passwordHash와 salt가 포함되지 않는다', async () => {
    mockKv.smembers.mockResolvedValue(['user1@test.com']);
    mockKv.get.mockResolvedValue(makeUser('user1@test.com', '2025-01-01'));
    const res = makeRes();
    await handler(makeReq({ status: 'pending' }), res);
    const users = res.json.mock.calls[0][0].users;
    expect(users[0]).not.toHaveProperty('passwordHash');
    expect(users[0]).not.toHaveProperty('salt');
  });

  // 정상: createdAt 기준 내림차순 정렬
  it('createdAt 기준 내림차순으로 정렬한다', async () => {
    mockKv.smembers.mockResolvedValue(['old@test.com', 'new@test.com']);
    mockKv.get
      .mockResolvedValueOnce(makeUser('old@test.com', '2024-01-01'))
      .mockResolvedValueOnce(makeUser('new@test.com', '2025-06-01'));
    const res = makeRes();
    await handler(makeReq({ status: 'pending' }), res);
    const users = res.json.mock.calls[0][0].users;
    expect(users[0].email).toBe('new@test.com');
    expect(users[1].email).toBe('old@test.com');
  });

  // 정상: all 상태 필터 (3개 집합 병합)
  it('all 상태 필터는 모든 사용자를 반환한다', async () => {
    mockKv.smembers
      .mockResolvedValueOnce(['p@test.com']) // pending
      .mockResolvedValueOnce(['a@test.com']) // approved
      .mockResolvedValueOnce(['r@test.com']); // rejected
    mockKv.get
      .mockResolvedValueOnce(makeUser('p@test.com', '2025-01-01', 'pending'))
      .mockResolvedValueOnce(makeUser('a@test.com', '2025-02-01', 'approved'))
      .mockResolvedValueOnce(makeUser('r@test.com', '2025-03-01', 'rejected'));
    const res = makeRes();
    await handler(makeReq({ status: 'all' }), res);
    const users = res.json.mock.calls[0][0].users;
    expect(users).toHaveLength(3);
  });

  // 정상: 기본 상태는 pending
  it('상태 미지정 시 기본값 pending을 사용한다', async () => {
    mockKv.smembers.mockResolvedValue([]);
    const res = makeRes();
    await handler(makeReq({}), res);
    expect(mockKv.smembers).toHaveBeenCalledWith('users:pending');
  });

  // null 사용자 필터링 (kv.get이 null 반환하면 결과에서 제외)
  it('kv.get이 null인 사용자는 결과에서 제외된다', async () => {
    mockKv.smembers.mockResolvedValue(['exists@test.com', 'ghost@test.com']);
    mockKv.get
      .mockResolvedValueOnce(makeUser('exists@test.com', '2025-01-01'))
      .mockResolvedValueOnce(null);
    const res = makeRes();
    await handler(makeReq({ status: 'pending' }), res);
    const users = res.json.mock.calls[0][0].users;
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('exists@test.com');
  });
});
