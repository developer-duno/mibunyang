// @vitest-environment node
/**
 * supabase/unsold-history.ts 테스트 — 미분양 추이 시계열 API (ID 검증, 단일/복수 조회, 캐싱)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

/** Supabase 체이닝 모킹 */
const mockData = [
  { apartment_id: "ah-1", base_month: "2025-01", unsold_count: 50 },
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

const { default: handlerImport } = await import('./unsold-history.js');
const handler = handlerImport as any;

/** res 목 객체 팩토리 */
function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() } as any;
}

describe('supabase/unsold-history handler', () => {
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
    await handler({ method: 'GET', query: { apartment_id: 'DROP TABLE' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 정상 단일 조회
  it('정상 apartment_id로 데이터를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { apartment_id: 'ah-456' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  // 복수 조회 — apartment_ids
  it('apartment_ids로 복수 조회가 가능하다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { apartment_ids: 'ah-1,ah-2' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockQuery.in).toHaveBeenCalled();
  });

  // 캐싱 헤더 설정
  it('Cache-Control 헤더를 설정한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { apartment_id: 'ah-1' }, headers: {} }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=3600'));
  });
});

// 세션636 D10ⓑ: unsold-history 는 복수 id 응답을 한 달 한 값으로 접는다(mergeMonthly 배선) — 단일 함수 시험만으론 배선을 못 본다
describe('supabase/unsold-history — 한 달 한 값 배선(세션635 다)', () => {
  it('같은 달 두 행(복수 id) → 응답은 그 달 한 행, 요청 순서 첫 id 의 값', async () => {
    mockQuery.order.mockImplementationOnce(() =>
      Promise.resolve({
        data: [
          { apartment_id: 'ah-1', base_month: '2025-01', unsold_count: 50 },
          { apartment_id: 'ap-9', base_month: '2025-01', unsold_count: 7 },
        ],
        error: null,
      })
    );
    const res = makeRes();
    await handler({ method: 'GET', query: { apartment_ids: 'ap-9,ah-1' }, headers: {} }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.count).toBe(1);
    expect(body.data).toEqual([{ apartment_id: 'ap-9', base_month: '2025-01', unsold_count: 7 }]);
  });
});
