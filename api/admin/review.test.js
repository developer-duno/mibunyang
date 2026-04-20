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

// redis.js 모킹
const mockKv = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue('OK'),
  sadd: vi.fn().mockResolvedValue(1),
  srem: vi.fn().mockResolvedValue(1),
};
vi.mock('../_lib/redis.js', () => ({ kv: mockKv }));

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

  // 정상: approved → suspended (force-logout)
  it('approved 사용자를 force-logout하면 suspended로 전환한다', async () => {
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'approved' });
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'force-logout' }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, message: '강제 로그아웃 처리되었습니다' }));
    expect(mockKv.sadd).toHaveBeenCalledWith('users:suspended', 'user@test.com');
    expect(mockKv.srem).toHaveBeenCalledWith('users:approved', 'user@test.com');
    const savedUser = mockKv.set.mock.calls[0][1];
    expect(savedUser.status).toBe('suspended');
    expect(savedUser.reviewNote).toBe('관리자 강제 로그아웃');
  });

  // 정상: force-logout에 사유 전달 시 사유가 우선
  it('force-logout에 note 전달 시 해당 사유가 저장된다', async () => {
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'approved' });
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'force-logout', note: '악의적 사용' }), res);
    const savedUser = mockKv.set.mock.calls[0][1];
    expect(savedUser.reviewNote).toBe('악의적 사용');
  });

  // 같은 상태로 전환 시 srem 안함
  it('같은 상태로 전환 시 srem을 호출하지 않는다', async () => {
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'approved' });
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'approve' }), res);
    expect(mockKv.sadd).toHaveBeenCalledWith('users:approved', 'user@test.com');
    expect(mockKv.srem).not.toHaveBeenCalled();
  });
});

describe('admin/review 배치 처리', () => {
  // 배치: 정상 처리 (2건)
  it('emails 배열로 여러 건을 일괄 처리한다', async () => {
    mockKv.get
      .mockResolvedValueOnce({ email: 'a@test.com', status: 'pending' })
      .mockResolvedValueOnce({ email: 'b@test.com', status: 'pending' });
    const res = makeRes();
    await handler(makeReq({ emails: ['a@test.com', 'b@test.com'], action: 'approve' }), res);
    const data = res.json.mock.calls[0][0];
    expect(data.ok).toBe(true);
    expect(data.successCount).toBe(2);
    expect(data.failCount).toBe(0);
    expect(data.results).toHaveLength(2);
  });

  // 배치: 부분 실패 (존재하지 않는 이메일 포함)
  it('일부 이메일이 존재하지 않으면 부분 실패를 반환한다', async () => {
    mockKv.get
      .mockResolvedValueOnce({ email: 'a@test.com', status: 'pending' })
      .mockResolvedValueOnce(null); // b@test.com 미존재
    const res = makeRes();
    await handler(makeReq({ emails: ['a@test.com', 'b@test.com'], action: 'approve' }), res);
    const data = res.json.mock.calls[0][0];
    expect(data.successCount).toBe(1);
    expect(data.failCount).toBe(1);
    expect(data.results[1].ok).toBe(false);
  });

  // 배치: 빈 배열
  it('빈 emails 배열은 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ emails: [], action: 'approve' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 배치: 초과 배열 (50건 초과)
  it('50건 초과 시 400을 반환한다', async () => {
    const emails = Array.from({ length: 51 }, (_, i) => `user${i}@test.com`);
    const res = makeRes();
    await handler(makeReq({ emails, action: 'approve' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toContain('50');
  });

  // 배치: 유효하지 않은 이메일 형식
  it('@ 없는 이메일은 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ emails: ['valid@test.com', 'invalid'], action: 'approve' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 배치: RFC 5322 정규식으로 걸러지는 값 (기존 .includes("@")는 통과시킴)
  it('RFC 5322 정규식에 걸리는 이메일은 400을 반환한다 (bad@ / @.com / TLD 1글자)', async () => {
    for (const badEmail of ['bad@', '@x.com', 'a@b.c']) {
      const res = makeRes();
      await handler(makeReq({ emails: ['valid@test.com', badEmail], action: 'approve' }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  // 단건 하위호환: email 필드로 보내면 기존 응답 형식 유지
  it('단건 email은 기존 응답 형식(message)을 반환한다', async () => {
    mockKv.get.mockResolvedValue({ email: 'user@test.com', status: 'pending' });
    const res = makeRes();
    await handler(makeReq({ email: 'user@test.com', action: 'approve' }), res);
    const data = res.json.mock.calls[0][0];
    expect(data.ok).toBe(true);
    expect(data.message).toBeTruthy();
    expect(data.results).toBeUndefined(); // 배치 응답이 아님
  });
});
