// @vitest-environment node
/**
 * admin/subscribers.ts 테스트 — 통계, 발송 로그 매핑, phone 마스킹, 부분 성공 (세션 467 PR2)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-key-for-auth';
  vi.clearAllMocks();
});

// adminAuth 모킹 (users.test.ts 답습)
vi.mock('../_lib/adminAuth.js', () => ({
  verifyAdminToken: vi.fn().mockReturnValue({ email: 'admin@test.com', role: 'admin' }),
}));

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// Supabase 모킹 — from() 호출 순서대로 thenable 빌더 반환
// (핸들러 순서: subscribers 통계 4 → notification_logs 1 → apartments/subscribers 조인)
function makeBuilder(result: any) {
  const b: any = {};
  for (const m of ['select', 'is', 'not', 'order', 'limit', 'in']) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return b;
}
const mockFrom = vi.fn();
vi.mock('../_lib/supabase.js', () => ({
  getMibuyangSupabase: () => ({ from: mockFrom }),
}));

const { default: handler, maskPhoneE164 } = await import('./subscribers.js');

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as any;
}

function makeReq() {
  return { method: 'GET', query: {}, headers: { authorization: 'Bearer valid' } };
}

describe('maskPhoneE164 — PII 마스킹 경계', () => {
  it('E.164 표준 길이는 중간 자리를 가린다', () => {
    expect(maskPhoneE164('+821012345678')).toBe('+8210****5678');
  });
  it('null/undefined/8자 미만은 전체 마스킹한다', () => {
    expect(maskPhoneE164(null)).toBe('****');
    expect(maskPhoneE164(undefined)).toBe('****');
    expect(maskPhoneE164('+82')).toBe('****');
  });
});

describe('admin/subscribers handler', () => {
  it('통계 + 발송 로그를 매핑해 응답한다 (phone 은 마스킹만, 원문·subscriber_id 미노출)', async () => {
    mockFrom
      .mockReturnValueOnce(makeBuilder({ count: 3, error: null })) // total
      .mockReturnValueOnce(makeBuilder({ count: 2, error: null })) // active
      .mockReturnValueOnce(makeBuilder({ count: 1, error: null })) // apartment 스코프
      .mockReturnValueOnce(makeBuilder({ count: 1, error: null })) // region 스코프
      .mockReturnValueOnce(
        makeBuilder({
          data: [
            {
              id: 1,
              subscriber_id: 7,
              apartment_id: 'ap-1',
              house_manage_no: '2026000001',
              event_date: '2026-07-08',
              channel: 'dry_run',
              status: 'dry_run',
              fail_reason: null,
              created_at: '2026-07-06T05:00:00Z',
            },
          ],
          error: null,
        })
      ) // notification_logs
      .mockReturnValueOnce(makeBuilder({ data: [{ id: 'ap-1', name: '테스트단지' }], error: null })) // apartments
      .mockReturnValueOnce(makeBuilder({ data: [{ id: 7, phone: '+821012345678' }], error: null })); // subscribers 조인

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.stats).toEqual({
      total: 3,
      active: 2,
      optedOut: 1,
      byScope: { apartment: 1, region: 1, nationwide: 0 },
    });
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].apartmentName).toBe('테스트단지');
    expect(body.logs[0].phoneMasked).toBe('+8210****5678');
    expect(body.logs[0].phone).toBeUndefined();
    expect(body.logs[0].subscriber_id).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('+821012345678');
  });

  it('notification_logs 조회 실패(마이그 미적용 등)여도 통계는 200 부분 성공으로 응답한다', async () => {
    mockFrom
      .mockReturnValueOnce(makeBuilder({ count: 3, error: null }))
      .mockReturnValueOnce(makeBuilder({ count: 2, error: null }))
      .mockReturnValueOnce(makeBuilder({ count: 1, error: null }))
      .mockReturnValueOnce(makeBuilder({ count: 1, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: null, error: { message: 'relation "notification_logs" does not exist' } }));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.stats.total).toBe(3);
    expect(body.logs).toEqual([]);
    expect(body.logsError).toMatch(/발송 로그 조회 실패/);
  });

  it('통계 쿼리 실패 시 500 을 반환한다', async () => {
    mockFrom
      .mockReturnValueOnce(makeBuilder({ count: null, error: { message: 'boom' } }))
      .mockReturnValueOnce(makeBuilder({ count: 0, error: null }))
      .mockReturnValueOnce(makeBuilder({ count: 0, error: null }))
      .mockReturnValueOnce(makeBuilder({ count: 0, error: null }));

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET 이외 메서드는 405 를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {}, headers: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
