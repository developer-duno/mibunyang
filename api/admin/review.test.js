// @vitest-environment node
/**
 * admin/review.js 테스트 — 상태 전환, 롤백 시나리오
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

// rateLimit 모킹 — admin rateLimit 추가로 인한 pipeline mock 필요
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// @vercel/kv 모킹
const mockKv = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue('OK'),
  sadd: vi.fn().mockResolvedValue(1),
  srem: vi.fn().mockResolvedValue(1),
};
vi.mock('@vercel/kv', () => ({ kv: mockKv }));

const { default: handler } = await import('./review.js');
const { verifyAdminToken } = await import('../_lib/adminAuth.js');

/** res 목 객체 팩토리 */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
}

/** req 목 객체 팩토리 */
function makeReq(body = {}) {
  return { method: 'POST', body, headers: { authorization: 'Bearer valid-admin-token' } };
}

describe('admin/review handler', () => {
  // 에러: POST 이외 메서드
  it('POST가 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: 관리자 인증 실패
  it('관리자 인증 실패 시 401을 반환한다', async () => {
    verifyAdminToken.mockReturnValueOnce(null);
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'approve' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // 에러: 잘못된 액션
  it('잘못된 action은 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'delete' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 이메일 누락
  it('이메일 누락 시 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ action: 'approve' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 사용자 없음
  it('존재하지 않는 사용자는 404를 반환한다', async () => {
    mockKv.get.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq({ email: 'noone@test.com', action: 'approve' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // 정상: pending → approved
  it('pending 사용자를 approve하면 성공한다', async () => {
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'pending' });
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'approve' }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(mockKv.sadd).toHaveBeenCalledWith('users:approved', 'user@test.com');
    expect(mockKv.srem).toHaveBeenCalledWith('users:pending', 'user@test.com');
    // kv.set에 status: "approved"가 포함된 객체가 전달되어야 함
    const savedUser = mockKv.set.mock.calls[0][1];
    expect(savedUser.status).toBe('approved');
    expect(savedUser.reviewedAt).toBeTruthy();
  });

  // 정상: pending → rejected
  it('pending 사용자를 reject하면 성공한다', async () => {
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'pending' });
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'reject', note: '사유' }), res);
    expect(mockKv.sadd).toHaveBeenCalledWith('users:rejected', 'user@test.com');
    expect(mockKv.srem).toHaveBeenCalledWith('users:pending', 'user@test.com');
    const savedUser = mockKv.set.mock.calls[0][1];
    expect(savedUser.reviewNote).toBe('사유');
  });

  // 에러: sadd 성공 후 srem 실패 → sadd 복원
  it('srem 실패 시 sadd를 복원하고 500을 반환한다', async () => {
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'pending' });
    mockKv.sadd.mockResolvedValueOnce(1);
    mockKv.srem.mockRejectedValueOnce(new Error('Redis error'));
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'approve' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    // 복원 시도: srem('users:approved', ...) 호출
    expect(mockKv.srem).toHaveBeenCalledWith('users:approved', 'user@test.com');
  });

  // 에러: set 실패 → 집합 복원
  it('set 실패 시 집합을 복원하고 500을 반환한다', async () => {
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'pending' });
    mockKv.set.mockRejectedValueOnce(new Error('Redis error'));
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'approve' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // 같은 상태로 전환 시 srem 안함
  it('같은 상태로 전환 시 srem을 호출하지 않는다', async () => {
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'approved' });
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'approve' }), res);
    // sadd는 호출하지만 srem은 호출하지 않아야 함 (oldStatus === newStatus)
    expect(mockKv.sadd).toHaveBeenCalledWith('users:approved', 'user@test.com');
    // srem should NOT be called (same status)
    expect(mockKv.srem).not.toHaveBeenCalled();
  });
});
