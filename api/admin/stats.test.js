// @vitest-environment node
/**
 * admin/stats.js 테스트 — 통계 조회 + 인증 실패
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

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// @vercel/kv 모킹
const mockKv = {
  scard: vi.fn().mockResolvedValue(0),
  smembers: vi.fn().mockResolvedValue([]),
  get: vi.fn(),
};
vi.mock('@vercel/kv', () => ({ kv: mockKv }));

const { default: handler } = await import('./users.js');
const { verifyAdminToken } = await import('../_lib/adminAuth.js');

/** res 목 객체 팩토리 */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
}

describe('GET /api/admin/stats', () => {
  it('정상 응답 — 상태별 카운트 + 유형 + 분야 + 타임라인', async () => {
    // scard 모킹: pending 2, approved 5, rejected 1, suspended 0
    mockKv.scard
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    // smembers 모킹 (전체 이메일)
    mockKv.smembers
      .mockResolvedValueOnce(['a@test.com', 'b@test.com'])
      .mockResolvedValueOnce(['c@test.com', 'd@test.com', 'e@test.com', 'f@test.com', 'g@test.com'])
      .mockResolvedValueOnce(['h@test.com'])
      .mockResolvedValueOnce([]);

    // 사용자 데이터 모킹
    const today = new Date().toISOString();
    mockKv.get
      .mockResolvedValueOnce({ email: 'a@test.com', specialty: '분양 컨설팅', createdAt: today })
      .mockResolvedValueOnce({ email: 'b@test.com', kakaoId: '123', role: 'user', createdAt: today })
      .mockResolvedValueOnce({ email: 'c@test.com', specialty: '부동산 중개', createdAt: today })
      .mockResolvedValueOnce({ email: 'd@test.com', kakaoId: '456', role: 'user', createdAt: today })
      .mockResolvedValueOnce({ email: 'e@test.com', specialty: '분양 컨설팅', createdAt: today })
      .mockResolvedValueOnce({ email: 'f@test.com', kakaoId: '789', role: 'user', createdAt: today })
      .mockResolvedValueOnce({ email: 'g@test.com', specialty: '감정평가', createdAt: today })
      .mockResolvedValueOnce({ email: 'h@test.com', specialty: '부동산 중개', createdAt: '2020-01-01T00:00:00Z' });

    const req = { method: 'GET', query: { action: 'stats' }, headers: { authorization: 'Bearer valid' } };
    const res = makeRes();
    await handler(req, res);

    const data = res.json.mock.calls[0][0];
    expect(data.ok).toBe(true);
    expect(data.counts).toEqual({ pending: 2, approved: 5, rejected: 1, suspended: 0, total: 8 });
    expect(data.userTypes.kakao).toBe(3);
    expect(data.userTypes.expert).toBe(5);
    expect(data.specialtyDist['분양 컨설팅']).toBe(2);
    expect(data.specialtyDist['부동산 중개']).toBe(2);
    expect(data.specialtyDist['감정평가']).toBe(1);
    expect(data.recentSignups).toHaveLength(14);
    // 오늘 날짜에 7명 가입 (h@test.com은 14일 이전)
    const todayEntry = data.recentSignups.find(e => e.date === today.slice(0, 10));
    expect(todayEntry.count).toBe(7);
  });

  it('인증 실패 시 401 반환', async () => {
    verifyAdminToken.mockReturnValueOnce(null);

    const req = { method: 'GET', query: {}, headers: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
