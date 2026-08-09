// @vitest-environment node
/**
 * supabase/apartments.ts 테스트 — sanitize 함수 null 기본값, 필터링, 캐시 헤더, 배치 페이지네이션
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// rateLimit 모킹 — withHandler의 checkRateLimit 경로 우회
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// Supabase 모킹 — 배치 페이지네이션을 위해 range 호출마다 다른 결과 반환 가능
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

const { default: handlerImport } = await import('./apartments.js');
const handler = handlerImport as any;

/** res 목 객체 팩토리 */
function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    end: vi.fn(),
  };
  return res as any;
}

/** req 목 객체 팩토리 */
function makeReq(query: any = {}) {
  return { method: 'GET', query, headers: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handler', () => {
  // 에러: GET 이외 메서드
  it('GET이 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {}, headers: {} }, res);
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

  // 정상: 명시적 limit/offset → 단일 쿼리 경로
  it('limit/offset 파라미터를 안전하게 처리한다 (단일 쿼리)', async () => {
    mockQuery.range.mockResolvedValue({ data: [], error: null, count: 0 });
    const res = makeRes();
    await handler(makeReq({ limit: '50', offset: '10' }), res);
    expect(mockQuery.range).toHaveBeenCalledWith(10, 59); // offset=10, limit=50 → range(10, 59)
  });

  // 정상: 음수/비정상 limit 처리
  it('비정상 limit은 최소 1로 클램핑한다', async () => {
    const res = makeRes();
    await handler(makeReq({ limit: '-5' }), res);
    expect(mockQuery.range).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('array query values return 400 before querying', async () => {
    const res = makeRes();
    await handler(makeReq({ limit: ['1', '2'] }), res);
    expect(mockQuery.range).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 배치 페이지네이션: 1000개 이하 → 단일 배치
  it('1000개 이하 데이터는 단일 배치로 반환한다', async () => {
    const rows = Array.from({ length: 800 }, (_, i) => ({ id: i + 1, name: `apt${i}`, region: '경기' }));
    mockQuery.range.mockResolvedValueOnce({ data: rows, error: null, count: 800 });
    const res = makeRes();
    await handler(makeReq(), res);
    // range는 첫 배치만 호출 (0, 999)
    expect(mockQuery.range).toHaveBeenCalledTimes(1);
    expect(mockQuery.range).toHaveBeenCalledWith(0, 999);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.length).toBe(800);
    expect(res.json.mock.calls[0][0].count).toBe(800);
  });

  // 배치 페이지네이션: 1500개 → 2배치
  it('1000개 초과 데이터는 배치 페이지네이션으로 전체를 반환한다', async () => {
    const batch1 = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, name: `apt${i}`, region: '경기' }));
    const batch2 = Array.from({ length: 500 }, (_, i) => ({ id: i + 1001, name: `apt${i + 1000}`, region: '경기' }));
    mockQuery.range
      .mockResolvedValueOnce({ data: batch1, error: null, count: 1500 }) // 첫 배치 (count 포함)
      .mockResolvedValueOnce({ data: batch2, error: null }); // 두 번째 배치
    const res = makeRes();
    await handler(makeReq(), res);
    expect(mockQuery.range).toHaveBeenCalledTimes(2);
    expect(mockQuery.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockQuery.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.length).toBe(1500);
    expect(res.json.mock.calls[0][0].count).toBe(1500);
  });

  // 배치 에러 시 부분 데이터 반환 (graceful degradation)
  it('배치 에러 시 첫 배치 데이터만이라도 반환한다', async () => {
    const batch1 = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, name: `apt${i}`, region: '경기' }));
    mockQuery.range
      .mockResolvedValueOnce({ data: batch1, error: null, count: 1500 })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    // 첫 배치 1000개는 반환
    expect(res.json.mock.calls[0][0].data.length).toBe(1000);
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
    // 세션508: builderDebtRatio 는 250 폴백 제거, null 보존(모름=중립, scoreRisk 가 처리).
    expect(responseData.builderDebtRatio).toBeNull();
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
    // 세션508: loanFree 는 false 폴백 제거, null 보존(모름=무페널티, scoreRisk 가 처리).
    //   optionFree/balconyFree/contractDiscount 는 스코어링 미사용 정보성 필드라 그대로 false 유지.
    expect(responseData.discountPct).toBe(0);
    expect(responseData.loanFree).toBeNull();
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
    expect(responseData.nearbyChildcare).toEqual([]);
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

  // 세션 446: 무력화 대상은 unsoldRate(률)뿐. unsold(세대수)는 raw 보존 (collect-data·VIEW 와 동일).
  it('unsoldRate > 100%이면 unsoldRate만 null, unsold(세대수)는 raw 보존', async () => {
    const row = { id: 1, name: 'Test', region: '경기', units: 100, unsold: 200, unsoldRate: 200 };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.unsoldRate).toBeNull();
    expect(d.unsold).toBe(200);
  });

  // 세션 446: 회차 폭발 패턴(용인 칸타빌 — units=회차 공급분 17, unsold=단지 전체 미분양 39).
  //   unsoldRate(130%)는 무력화(null)되지만 unsold(39 세대)는 raw 보존 → '미분양만 보기'에서
  //   사라지거나 '입주완료' 둔갑하던 잠복 P1 차단 (세션445 AptCard moveInDone 함정과 동형).
  it('회차 폭발 단지도 unsold(세대수)는 raw 보존 (입주완료 둔갑·미분양만보기 누락 방지)', async () => {
    const row = { id: 1, name: 'Test', region: '경기', units: 17, unsold: 39, unsoldRate: 130 };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.unsoldRate).toBeNull();
    expect(d.unsold).toBe(39);
  });

  // 세션 445: 100% 이하는 그대로 (?? 50 폴백 제거 — raw 값 정직 통과). 100 정확히는 유지.
  it('unsoldRate 100 이하는 그대로 통과한다 (?? 50 폴백 제거)', async () => {
    const row = { id: 1, name: 'Test', region: '경기', units: 100, unsold: 30, unsoldRate: 30 };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.json.mock.calls[0][0].data[0].unsoldRate).toBe(30);
  });

  // 세션 445: units>1 인데 raw unsoldRate 가 null 이면 null 유지 (예전엔 50 으로 채웠음 → 점수 임의 등급).
  it('units>1 + unsoldRate null이면 null 유지 (50 폴백 안 함)', async () => {
    const row = { id: 1, name: 'Test', region: '경기', units: 100, unsold: 10, unsoldRate: null };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.json.mock.calls[0][0].data[0].unsoldRate).toBeNull();
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

  // 교통 상세 필드: subwayName, subwayLines, busStopNames가 sanitize에 포함되는지 검증
  it('교통 상세 필드가 API 응답에 포함된다 (subwayName, subwayLines, busStopNames)', async () => {
    const row = {
      id: 1, name: 'Test', region: '경기',
      subwayName: '강남역', subwayLines: '2호선,신분당선', busStopNames: '강남역사거리,역삼동주민센터',
    };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.subwayName).toBe('강남역');
    expect(d.subwayLines).toBe('2호선,신분당선');
    expect(d.busStopNames).toBe('강남역사거리,역삼동주민센터');
  });

  // 교통 상세 필드 null → null 기본값 (비관적이 아닌 nullable)
  it('교통 상세 필드 null → null 반환', async () => {
    const row = { id: 1, name: 'Test', region: '경기' };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.subwayName).toBeNull();
    expect(d.subwayLines).toBeNull();
    expect(d.busStopNames).toBeNull();
  });

  // 신규 필드 5건 (address, roadAddress, district, avgMaintenanceCost, primaryDirection)
  it('신규 5개 필드가 값 있을 때 정상 통과한다', async () => {
    const row = {
      id: 1, name: 'Test', region: '경기',
      address: '경기도 화성시 동탄면 123',
      roadAddress: '경기도 화성시 동탄대로 456',
      district: '동탄2신도시',
      avgMaintenanceCost: 15,
      primaryDirection: '남향',
    };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.address).toBe('경기도 화성시 동탄면 123');
    expect(d.roadAddress).toBe('경기도 화성시 동탄대로 456');
    expect(d.district).toBe('동탄2신도시');
    expect(d.avgMaintenanceCost).toBe(15);
    expect(d.primaryDirection).toBe('남향');
  });

  // 신규 5개 필드 null → null 기본값
  it('신규 5개 필드 null → null 반환', async () => {
    const row = { id: 1, name: 'Test', region: '경기' };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.address).toBeNull();
    expect(d.roadAddress).toBeNull();
    expect(d.district).toBeNull();
    expect(d.avgMaintenanceCost).toBeNull();
    expect(d.primaryDirection).toBeNull();
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

  // KOSIS 시장 통계 5개 필드 — 정보성 ?? null
  it('KOSIS 시장 통계 필드가 값 전달 및 null 기본값 동작', async () => {
    const row = { id: 1, name: 'Test', region: '경기', priceIndex: 232.0, avgPriceSqm: 7312, newSupply: 3279, initialSaleRate: 80.1, landCostRatio: 40, housingSupplyLevel: 99.4 };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    // 값이 있을 때 그대로 전달
    expect(d.priceIndex).toBe(232.0);
    expect(d.avgPriceSqm).toBe(7312);
    expect(d.newSupply).toBe(3279);
    expect(d.initialSaleRate).toBe(80.1);
    expect(d.landCostRatio).toBe(40);
    // 주택보급률 (세션 457) — 정보성 ?? null, 점수 미반영
    expect(d.housingSupplyLevel).toBe(99.4);
  });

  it('KOSIS 시장 통계 null → null 기본값', async () => {
    const row = { id: 1, name: 'Test', region: '경기' };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.priceIndex).toBeNull();
    expect(d.avgPriceSqm).toBeNull();
    expect(d.newSupply).toBeNull();
    expect(d.initialSaleRate).toBeNull();
    expect(d.landCostRatio).toBeNull();
    expect(d.housingSupplyLevel).toBeNull();
  });

  // 세션 508: hugGuarantee 는 null 보존 (수집률 0% — `?? false` 로 굳히면 전 단지가 "보증 없음"이 되어
  //   scoreRisk 에서 +40 위험 페널티를 먹는다. unsoldRate 세션445 선례와 같은 결).
  it('hugGuarantee null → false 로 강제되지 않고 null 보존', async () => {
    const row = { id: 1, name: 'Test', region: '경기' }; // hugGuarantee 부재 = 미수집
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];
    expect(d.hugGuarantee).toBeNull();
    expect(d.hugGuarantee).not.toBe(false);
    // 대조군: 같은 sanitizeTransaction 블록의 isRegulated·dsr40pass 는 기존대로 false 강제 유지
    expect(d.isRegulated).toBe(false);
    expect(d.dsr40pass).toBe(false);
  });

  it('hugGuarantee 값이 있으면 그대로 전달 (true/false)', async () => {
    for (const v of [true, false]) {
      const row = { id: 1, name: 'Test', region: '경기', hugGuarantee: v };
      mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.json.mock.calls[0][0].data[0].hugGuarantee).toBe(v);
    }
  });

  // 리팩토링 회귀 방어: sanitize()가 모든 필드를 반환하는지 전수 검증
  it('sanitize()는 전체 필드를 반환한다 (리팩토링 회귀 방어)', async () => {
    const row = { id: 1, name: 'X', region: '경기' };
    mockQuery.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    const res = makeRes();
    await handler(makeReq(), res);
    const d = res.json.mock.calls[0][0].data[0];

    const expectedKeys = [
      // _fallback 11개
      '_fallbackPir', '_fallbackPsr', '_fallbackJeonseRate', '_fallbackSupplyRatio',
      '_fallbackUnsoldRate', '_fallbackBuilderDebt', '_fallbackDataReliability',
      '_fallbackNearbyMedian', '_fallbackNearbyBuildYear', '_fallbackAvgFloor',
      '_fallbackCancelRatio6m',
      // 기본 + 위치
      'id', 'name', 'dong', 'gu', 'region', 'address', 'roadAddress', 'district',
      'lat', 'lng', 'builder', 'avgMaintenanceCost', 'primaryDirection',
      'heatFuel', 'corridorType', 'buildingCoverageRatio', 'layout', 'floors',
      'units', 'unsold', 'unsoldRate', 'updatedAt', 'completion', 'heating',
      'maxFloor', 'parkingRatio', 'floorAreaRatio', 'exclusiveRatio',
      'energyGrade', 'greenBldg', 'quakeDesign', 'hasPool', 'announcementUrl',
      // 혜택
      'discountPct', 'loanFree', 'loanFreePct', 'optionFree', 'optionValue',
      'balconyFree', 'balconyValue', 'cashback', 'contractDiscount', 'benefits',
      // 미래가치 + 환경
      'transitDev', 'devDist', 'cityDev', 'industryDev',
      'view', 'sunlight', 'noise', 'noxious', 'noxiousDist',
      // 분양가
      'area', 'price', 'pp',
      // 인프라
      'hospital', 'hospitalDist', 'mart', 'conv', 'cafe', 'culture', 'bank',
      'pharmacy', 'martDist', 'convDist', 'parkDist', 'cafeDist', 'cultureDist',
      'bankDist', 'pharmacyDist', 'park', 'subwayDist', 'nearbyFacilities',
      'childcare', 'childcareDist', 'emergency', 'emergencyDist', 'police', 'policeDist',
      // 대기질/치안/학군
      'airQuality', 'crimeSafetyGrade', 'schoolScore', 'schoolGrade', 'nearbySchools', 'nearbyChildcare',
      // 교통
      'busRoutes', 'icDist', 'ktxDist', 'subwayName', 'subwayLines', 'busStopNames',
      // 건설사/지역
      'builderDebtRatio', 'builderCreditGrade',
      'popGrowth', 'netMigration', 'supplyRatio',
      // KOSIS 통계
      'priceIndex', 'avgPriceSqm', 'newSupply', 'initialSaleRate', 'landCostRatio', 'housingSupplyLevel',
      // 공시가격 (세션 505) — sanitize 는 허용목록이라, 이 줄이 빠지면 VIEW 에 값이 있어도 응답에서 사라진다
      'housingPrice',
      // 청약 경쟁률
      'competitionRate', 'competitionSupply', 'competitionApplicants',
      // 무순위 이벤트
      'unsoldEventCount', 'lastUnsoldEventAt',
      // 실거래
      'nearbyMedian', 'recentTrades6m', 'nearbyBuildYear', 'avgFloor', 'floorRange',
      'jeonseRate', 'pir', 'psr', 'cancelRatio6m',
      // 규제/보증
      'isRegulated', 'dsr40pass', 'hugGuarantee',
      // 시세 배열
      'priceByArea', 'rentByArea', 'jeonseByArea', 'priceByFloor',
      // 메타
      'dataReliability',
      // 네이버 교차검증
      'naverNearbyMedian', 'naverNearbyAvg', 'naverJeonseRate', 'naverSellCount',
      'naverJeonseCount', 'naverWolseCount', 'naverBuildYear', 'naverAvgFloor',
      'naverSchoolWalkMin', 'naverNearbyCount', 'naverFetchedAt',
      // 건축HUB 에너지
      'elecUsageKwh', 'gasUsageMj', 'energyCollectedAt',
      // 스코어링 캐시
      'catsCache',
      // 분양정보 19개
      'presaleMinPrice', 'presaleMaxPrice', 'presalePp', 'presaleType',
      'presaleStage', 'presaleStageCode', 'presaleImageUrl', 'naverPresaleNo',
      'naverPresaleSeq', 'presaleGeneralSupply', 'presaleBuildings', 'presaleParking',
      'presaleInquiry', 'presaleFeatures', 'presaleMoveIn', 'presaleRecruitDate',
      'presaleSchedule', 'presaleHousingType', 'presaleFetchedAt',
    ];
    for (const key of expectedKeys) {
      expect(d).toHaveProperty(key);
    }
  });
});
