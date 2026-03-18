// @vitest-environment node
/**
 * supabase/apartments.js 테스트 — sanitize 함수 null 기본값, 필터링, 캐시 헤더
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Supabase 모킹
const mockQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

vi.mock('../_lib/supabase.js', () => ({
  getSupabase: () => ({
    from: vi.fn((table) => {
      if (table === 'apartments') {
        return {
          select: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { updated_at: '2025-01-01T00:00:00Z' } }),
                }),
              }),
            }),
          }),
        };
      }
      return mockQuery;
    }),
  }),
}));

const { default: handler } = await import('./apartments.js');

/** res 목 객체 팩토리 */
function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
  return res;
}

/** req 목 객체 팩토리 */
function makeReq(query = {}) {
  return { method: 'GET', query };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handler', () => {
  // 에러: GET 이외 메서드
  it('GET이 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  // 정상: 데이터 반환 및 캐시 헤더
  it('정상 응답 시 Cache-Control 헤더를 설정한다', async () => {
    mockQuery.select.mockReturnThis();
    mockQuery.range.mockResolvedValue({ data: [], error: null, count: 0 });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=60'));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // 에러: Supabase 에러
  it('Supabase 에러 시 500을 반환한다', async () => {
    mockQuery.range.mockResolvedValue({ data: null, error: { message: 'DB error' }, count: null });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // 정상: region/gu 필터 적용
  it('region/gu 쿼리 파라미터로 필터링한다', async () => {
    mockQuery.range.mockResolvedValue({ data: [], error: null, count: 0 });
    const res = makeRes();
    await handler(makeReq({ region: '경기', gu: '화성시' }), res);
    expect(mockQuery.eq).toHaveBeenCalledWith('region', '경기');
    expect(mockQuery.eq).toHaveBeenCalledWith('gu', '화성시');
  });

  // 정상: limit/offset 안전 처리
  it('limit/offset 파라미터를 안전하게 처리한다', async () => {
    mockQuery.range.mockResolvedValue({ data: [], error: null, count: 0 });
    const res = makeRes();
    await handler(makeReq({ limit: '50', offset: '10' }), res);
    expect(mockQuery.range).toHaveBeenCalledWith(10, 59); // offset=10, limit=50 → range(10, 59)
  });

  // 정상: 음수/비정상 limit 처리
  it('비정상 limit은 최소 1로 클램핑한다', async () => {
    mockQuery.range.mockResolvedValue({ data: [], error: null, count: 0 });
    const res = makeRes();
    await handler(makeReq({ limit: '-5' }), res);
    expect(mockQuery.range).toHaveBeenCalledWith(0, 0); // min(max(1, -5), 10000) = 1, range(0, 0)
  });
});

describe('sanitize (null → 기본값)', () => {
  // sanitize 함수를 간접 테스트 (handler를 통해)
  it('위험 필드 null → 비관적 기본값, 혜택 필드 null → 0/false', async () => {
    const nullRow = {
      id: 1, name: '테스트아파트', region: '경기',
      // 나머지 모두 null/undefined
    };
    mockQuery.range.mockResolvedValue({ data: [nullRow], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);

    const responseData = res.json.mock.calls[0][0].data[0];

    // 비관적 기본값 (위험 필드)
    expect(responseData.builderDebtRatio).toBe(250);
    expect(responseData.supplyRatio).toBe(150);
    expect(responseData.pir).toBe(10);
    expect(responseData.psr).toBe(1.5);
    expect(responseData.jeonseRate).toBe(40);
    expect(responseData.subwayDist).toBe(9999);
    expect(responseData.icDist).toBe(99);
    expect(responseData.ktxDist).toBe(99);
    expect(responseData.dataReliability).toBe(30);
    expect(responseData.schoolScore).toBe(50);

    // 낙관적 기본값 (혜택 필드 → 0/false)
    expect(responseData.discountPct).toBe(0);
    expect(responseData.loanFree).toBe(false);
    expect(responseData.optionFree).toBe(false);
    expect(responseData.balconyFree).toBe(false);
    expect(responseData.cashback).toBe(0);
    expect(responseData.optionValue).toBe(0);
    expect(responseData.balconyValue).toBe(0);
    expect(responseData.contractDiscount).toBe(false);

    // 배열 기본값
    expect(responseData.benefits).toEqual([]);
    expect(responseData.noxious).toEqual([]);
    expect(responseData.nearbySchools).toEqual([]);
    expect(responseData.nearbyFacilities).toEqual([]);
    expect(responseData.priceByArea).toEqual([]);
  });

  // unsoldRate 특수 로직: units <= 1이면 null
  it('units <= 1이면 unsoldRate는 null이다', async () => {
    const row = { id: 1, name: 'Test', region: '경기', units: 1, unsold: 0, unsoldRate: 50 };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.json.mock.calls[0][0].data[0].unsoldRate).toBeNull();
  });

  // unsoldRate: unsold >= units이면 null (잘못된 데이터)
  it('unsold >= units이면 unsoldRate는 null이다', async () => {
    const row = { id: 1, name: 'Test', region: '경기', units: 100, unsold: 200, unsoldRate: 200 };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.unsoldRate).toBeNull();
    expect(d.unsold).toBeNull();
  });

  // _fallback 플래그 테스트
  it('null 필드에 _fallback 플래그가 true로 설정된다', async () => {
    const row = { id: 1, name: 'Test', region: '경기', pir: null, psr: null };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d._fallbackPir).toBe(true);
    expect(d._fallbackPsr).toBe(true);
  });

  // 네이버 폴백: nearbyMedian이 null이면 naverNearbyMedian 사용
  it('nearbyMedian null 시 naverNearbyMedian으로 폴백한다', async () => {
    const row = { id: 1, name: 'Test', region: '경기', nearbyMedian: null, naverNearbyMedian: 50000 };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.nearbyMedian).toBe(50000);
    expect(d._fallbackNearbyMedian).toBe(true);
  });
});
