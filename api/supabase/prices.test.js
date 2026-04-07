// @vitest-environment node
/**
 * supabase/prices.js 테스트 — 분양가 시계열 API (ID 검증, 단일/복수 조회, 캐싱)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Supabase 체이닝 모킹 */
const mockData = [
  { apartment_id: "ah-1", area: 84, price: 50000, recorded_at: "2025-01-01" },
];
const mockQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockImplementation(() => Promise.resolve({ data: mockData, error: null })),
};
vi.mock('../_lib/supabase.js', () => ({
  getSupabase: () => ({ from: vi.fn(() => mockQuery) }),
}));

beforeEach(() => { vi.clearAllMocks(); });

const { default: handler } = await import('./prices.js');

/** res 목 객체 팩토리 */
function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
}

describe('supabase/prices handler', () => {
  // GET 이외 메서드 → 405
  it('GET이 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 파라미터 없음 → 400
  it('apartment_id/apartment_ids 없으면 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 잘못된 ID 형식 → 400
  it('잘못된 apartment_id 형식은 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { apartment_id: 'invalid' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 정상 단일 조회
  it('정상 apartment_id로 데이터를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { apartment_id: 'ah-123' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  // 복수 조회 — apartment_ids
  it('apartment_ids로 복수 조회가 가능하다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { apartment_ids: 'ah-1,ah-2,ah-3' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockQuery.in).toHaveBeenCalled();
  });

  // apartment_ids 21개 초과 → 400
  it('apartment_ids 21개 이상이면 400을 반환한다', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `ah-${i}`).join(",");
    const res = makeRes();
    await handler({ method: 'GET', query: { apartment_ids: ids }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 캐싱 헤더 설정
  it('Cache-Control 헤더를 설정한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { apartment_id: 'ah-1' }, headers: {} }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=3600'));
  });
});
