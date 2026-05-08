// @vitest-environment node
// @ts-check
/**
 * kosis/stats.js 테스트 — URL 빌딩, row 파싱, 에러 처리
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.KOSIS_KEY = 'test-kosis-key';
  vi.clearAllMocks();
});

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// fetch 모킹
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { default: handlerImport } = await import('./stats.js');
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

/** KOSIS 응답 row 팩토리
 * @param {string} region
 * @param {string} period
 * @param {number} value
 */
function makeKosisRow(region, period, value) {
  return {
    C1_NM: '시도별미분양현황',
    C2_NM: region,
    PRD_DE: period,
    DT: String(value),
  };
}

describe('kosis/stats handler', () => {
  // 에러: GET 이외 메서드
  it('GET이 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST' }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: KOSIS_KEY 미설정
  it('KOSIS_KEY 미설정 시 500을 반환한다', async () => {
    delete process.env.KOSIS_KEY;
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    process.env.KOSIS_KEY = 'test-kosis-key';
  });

  // 정상: KOSIS 데이터 파싱
  it('KOSIS 데이터를 지역별로 파싱한다', async () => {
    const rows = [
      makeKosisRow('경기도', '2024', 5000),
      makeKosisRow('서울특별시', '2024', 1000),
      makeKosisRow('부산광역시', '2024', 2000),
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(rows) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data['경기'].unsoldCount).toBe(5000);
    expect(data['서울'].unsoldCount).toBe(1000);
    expect(data['부산'].unsoldCount).toBe(2000);
  });

  // 정상: 최신 기간 데이터만 사용
  it('같은 지역의 여러 기간 중 최신 데이터를 사용한다', async () => {
    const rows = [
      makeKosisRow('경기도', '2023', 3000),
      makeKosisRow('경기도', '2024', 5000),
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(rows) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.json.mock.calls[0][0].data['경기'].unsoldCount).toBe(5000);
  });

  // 정상: 매핑되지 않는 C1_NM은 무시
  it('시도별미분양현황이 아닌 row는 무시한다', async () => {
    const rows = [
      { C1_NM: '기타통계', C2_NM: '경기도', PRD_DE: '2024', DT: '999' },
      makeKosisRow('서울특별시', '2024', 500),
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(rows) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.json.mock.calls[0][0].data['서울'].unsoldCount).toBe(500);
  });

  // 정상: 데이터가 없는 지역은 null
  it('데이터가 없는 지역의 unsoldCount는 null이다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data['제주'].unsoldCount).toBeNull();
    expect(data['세종'].unsoldCount).toBeNull();
  });

  // KOSIS URL에 올바른 파라미터가 포함되는지 확인
  it('KOSIS API URL에 올바른 파라미터가 포함된다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('apiKey=test-kosis-key');
    expect(url).toContain('orgId=116');
    expect(url).toContain('tblId=DT_MLTM_2086');
    expect(url).toContain('format=json');
    expect(url).toContain('objL1=ALL');
    expect(url).toContain('objL2=ALL');
  });

  // 에러: KOSIS API HTTP 에러 → 502
  it('KOSIS API HTTP 에러 시 502를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  // 에러: KOSIS API err 응답 → 502
  it('KOSIS API err 응답 시 502를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ err: 'ERROR', errMsg: 'Invalid key' }) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  // 캐시 헤더
  it('성공 시 Cache-Control 헤더를 설정한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=86400'));
  });
});
