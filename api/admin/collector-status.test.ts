// @vitest-environment node
/**
 * admin/collector-status.ts 테스트 — 인증, 수집기별 최근 1회 추림, 부분 실패, 빈 데이터
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

/**
 * Supabase 모킹 — 테이블별로 다른 응답을 돌려준다.
 * runs/quota = collector_runs/api_quota_log, 나머지는 freshness 테이블.
 */
const mockData: { runs: any; quota: any; freshness: Record<string, any> } = {
  runs: { data: [], error: null },
  quota: { data: [], error: null },
  freshness: {},
};

/** .order().limit() 가 thenable (runs/quota 경로). */
function listChain(table: string) {
  return {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(
      table === 'collector_runs' ? mockData.runs : mockData.quota
    ),
  };
}

/** .not().order().limit() 가 thenable (freshness 경로). */
function freshnessChain(table: string) {
  return {
    select: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(
      mockData.freshness[table] ?? { data: [], error: null }
    ),
  };
}

vi.mock('../_lib/supabase.js', () => ({
  getSupabase: () => ({
    from: vi.fn((table: string) => {
      if (table === 'collector_runs' || table === 'api_quota_log') return listChain(table);
      return freshnessChain(table);
    }),
  }),
}));

const { default: handler } = await import('./collector-status.js');
const { verifyAdminToken } = await import('../_lib/adminAuth.js');

/** res 목 객체 팩토리 */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as any;
}

/** req 목 객체 팩토리 */
function makeReq() {
  return { method: 'GET', query: {}, headers: { authorization: 'Bearer valid' } };
}

/** mockData 를 기본값(빈 데이터)으로 리셋 */
function resetMockData() {
  mockData.runs = { data: [], error: null };
  mockData.quota = { data: [], error: null };
  mockData.freshness = {};
}

describe('admin/collector-status handler', () => {
  beforeEach(resetMockData);

  it('GET이 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('관리자 인증 실패 시 401을 반환한다', async () => {
    (verifyAdminToken as any).mockReturnValueOnce(null);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // collector_runs 0건이 현재 실상황 — 빈 데이터에서 깨지지 않아야 한다
  it('데이터가 없으면 collectors는 빈 배열, partial은 false', async () => {
    const res = makeRes();
    await handler(makeReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.collectors).toEqual([]);
    expect(body.partial).toBe(false);
    expect(body.errors).toEqual([]);
    // dataFreshness 는 7키 모두 존재 (값은 null)
    expect(Object.keys(body.dataFreshness).sort()).toEqual(
      ['apartments', 'builders', 'infra', 'regions', 'schools', 'trade_stats', 'transport']
    );
  });

  it('같은 수집기의 여러 행 중 최근 1회만 lastRun에 담는다', async () => {
    mockData.runs = {
      data: [
        { collector: 'collect-trades', status: 'success', ok_count: 120, fail_count: 0,
          skip_count: 3, elapsed_sec: 12.4, error_message: null,
          started_at: '2026-05-17T01:00:00Z', finished_at: '2026-05-17T01:05:00Z' },
        { collector: 'collect-trades', status: 'failure', ok_count: 0, fail_count: 5,
          skip_count: 0, elapsed_sec: 2.1, error_message: '이전 실패',
          started_at: '2026-05-16T01:00:00Z', finished_at: '2026-05-16T01:01:00Z' },
      ],
      error: null,
    };
    const res = makeRes();
    await handler(makeReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body.collectors).toHaveLength(1);
    expect(body.collectors[0].collector).toBe('collect-trades');
    // 최근 행(success) 만 반영, snake→camel 변환
    expect(body.collectors[0].lastRun.status).toBe('success');
    expect(body.collectors[0].lastRun.okCount).toBe(120);
    expect(body.collectors[0].lastRun.errorMessage).toBeNull();
  });

  it('api_quota_log는 수집기당 최대 5건까지만 담는다', async () => {
    mockData.quota = {
      data: Array.from({ length: 8 }, (_, i) => ({
        collector: 'infra-kakao', api_name: 'KAKAO_KEY', call_count: 100 + i,
        log_date: '2026-05-17', recorded_at: `2026-05-17T0${i}:00:00Z`,
      })),
      error: null,
    };
    const res = makeRes();
    await handler(makeReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body.collectors).toHaveLength(1);
    expect(body.collectors[0].recentQuota).toHaveLength(5);
    expect(body.collectors[0].recentQuota[0].apiName).toBe('KAKAO_KEY');
  });

  it('runs와 quota에만 등장하는 수집기를 모두 합쳐 노출한다', async () => {
    mockData.runs = {
      data: [{ collector: 'a-only', status: 'success', ok_count: 1, fail_count: 0,
        skip_count: 0, elapsed_sec: 1, error_message: null,
        started_at: null, finished_at: '2026-05-17T01:00:00Z' }],
      error: null,
    };
    mockData.quota = {
      data: [{ collector: 'b-only', api_name: 'X', call_count: 5,
        log_date: '2026-05-17', recorded_at: '2026-05-17T01:00:00Z' }],
      error: null,
    };
    const res = makeRes();
    await handler(makeReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body.collectors.map((c: any) => c.collector)).toEqual(['a-only', 'b-only']);
    expect(body.collectors[0].recentQuota).toEqual([]);
    expect(body.collectors[1].lastRun).toBeNull();
  });

  it('collector_runs 조회 실패 시 partial:true + errors에 기록', async () => {
    mockData.runs = { data: null, error: { message: 'DB error' } };
    const res = makeRes();
    await handler(makeReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.partial).toBe(true);
    expect(body.errors).toContain('collector_runs');
    expect(body.collectors).toEqual([]);
  });

  it('dataFreshness 테이블 조회 실패 시 해당 키는 null, partial:true', async () => {
    mockData.freshness = {
      apartments: { data: null, error: { message: 'timeout' } },
      infra: { data: [{ updated_at: '2026-05-16T00:00:00Z' }], error: null },
    };
    const res = makeRes();
    await handler(makeReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body.partial).toBe(true);
    expect(body.errors).toContain('dataFreshness.apartments');
    expect(body.dataFreshness.apartments).toBeNull();
    expect(body.dataFreshness.infra).toBe('2026-05-16T00:00:00Z');
  });

  it('regions는 recorded_at의 최신값을 dataFreshness에 담는다', async () => {
    mockData.freshness = {
      regions: { data: [{ recorded_at: '2026-05-15' }], error: null },
    };
    const res = makeRes();
    await handler(makeReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body.dataFreshness.regions).toBe('2026-05-15');
  });
});
