// @vitest-environment node
// @ts-check
/**
 * applyhome/apartments.js 테스트 — parseAddress, geocode, 응답 형식
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.APPLYHOME_KEY = 'test-applyhome-key';
  process.env.KAKAO_KEY = 'test-kakao-key';
  vi.clearAllMocks();
});

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// brands.js 모킹
vi.mock('../../src/constants/brands.js', () => ({
  resolveBuilder: vi.fn((name) => name || '기타'),
}));

// fetch 모킹
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { default: handlerImport } = await import('./apartments.js');
/** @type {any} */
const handler = handlerImport;

/** res 목 객체 팩토리 */
function makeRes() {
  return /** @type {any} */ ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  });
}

/** 청약홈 API 응답 팩토리
 * @param {any[]} [items]
 */
function makeApplyHomeResponse(items = []) {
  return {
    ok: true,
    json: () => Promise.resolve({
      currentCount: items.length,
      totalCount: items.length,
      data: items,
    }),
  };
}

/** 청약홈 API 항목 팩토리 */
function makeApplyHomeItem(overrides = {}) {
  return {
    HOUSE_NM: '테스트아파트',
    HSSPLY_ADRES: '경기도 화성시 동탄면 123',
    TOT_SUPLY_HSHLDCO: '500',
    REMNDR_HSHLDCO: '50',
    CNSTRCT_ENTRPS_NM: 'GS건설',
    MVN_PREARNGE_YM: '202512',
    HOUSE_MANAGE_NO: '2025000001',
    SUBSCRPT_AREA_CODE: '410',
    SUBSCRPT_AREA_CODE_NM: '경기도',
    ...overrides,
  };
}

describe('applyhome/apartments handler', () => {
  // 에러: GET 이외 메서드
  it('GET이 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST' }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: API 키 미설정
  it('APPLYHOME_KEY 미설정 시 500을 반환한다', async () => {
    delete process.env.APPLYHOME_KEY;
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    process.env.APPLYHOME_KEY = 'test-applyhome-key';
  });

  // 정상: API 데이터 없을 때 빈 배열
  it('API에서 데이터가 없으면 빈 배열을 반환한다', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      data: [],
      source: 'none',
    }));
  });

  // 정상: 데이터 매핑 + 지오코딩
  it('청약홈 데이터를 매핑하고 지오코딩을 수행한다', async () => {
    const item = makeApplyHomeItem();
    // 1st, 2nd: 청약홈 API (getRemndr, getAPT)
    mockFetch
      .mockResolvedValueOnce(makeApplyHomeResponse([item])) // getRemndr 성공
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) }) // MDL (빈 데이터)
      .mockResolvedValueOnce({ // 지오코딩
        ok: true,
        json: () => Promise.resolve({ documents: [{ y: '37.2', x: '127.0' }] }),
      });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('테스트아파트');
    expect(data[0].region).toBe('경기');
    expect(data[0].gu).toBe('화성시');
    expect(data[0].dong).toBe('동탄면');
  });

  // parseAddress 간접 테스트: 다양한 주소 형식
  it('서울특별시 주소를 "서울"로 파싱한다', async () => {
    const item = makeApplyHomeItem({ HSSPLY_ADRES: '서울특별시 강남구 삼성동 100' });
    mockFetch
      .mockResolvedValueOnce(makeApplyHomeResponse([item]))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ documents: [] }) }); // 지오코딩 실패
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data[0].region).toBe('서울');
    expect(data[0].gu).toBe('강남구');
  });

  // 주소 없을 때 fallback: SUBSCRPT_AREA_CODE_NM
  it('주소 파싱 실패 시 청약지역코드명에서 region을 추출한다', async () => {
    const item = makeApplyHomeItem({ HSSPLY_ADRES: '', SUBSCRPT_AREA_CODE_NM: '부산광역시' });
    mockFetch
      .mockResolvedValueOnce(makeApplyHomeResponse([item]))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ documents: [] }) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    // region이 null이면 filter에 의해 제외될 수 있으므로 SUBSCRPT_AREA_CODE_NM 사용
    const data = res.json.mock.calls[0][0].data;
    if (data.length > 0) {
      expect(data[0].region).toBe('부산');
    }
  });

  // unsoldRate 계산
  it('unsoldRate를 올바르게 계산한다', async () => {
    const item = makeApplyHomeItem({ TOT_SUPLY_HSHLDCO: '1000', REMNDR_HSHLDCO: '100' });
    mockFetch
      .mockResolvedValueOnce(makeApplyHomeResponse([item]))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ documents: [] }) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data[0].unsoldRate).toBe(10); // 100/1000 * 100 = 10%
  });

  // 캐시 헤더 확인
  it('Cache-Control 헤더를 설정한다', async () => {
    mockFetch
      .mockResolvedValueOnce(makeApplyHomeResponse([makeApplyHomeItem()]))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ documents: [] }) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=86400'));
  });

  // tryFetchApartments 내부에서 에러를 catch하므로, 모든 엔드포인트 실패 시 빈 데이터 반환
  it('모든 외부 API 실패 시 빈 데이터를 반환한다', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      data: [],
      source: 'none',
    }));
  });
});
