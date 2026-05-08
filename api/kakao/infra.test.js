// @vitest-environment node
// @ts-check
/**
 * kakao/infra.js 테스트 — 카테고리 카운트, 지하철 거리, 에러 기본값
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.KAKAO_KEY = 'test-kakao-key';
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ limited: false });
});

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// fetch 모킹
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { default: handlerImport } = await import('./infra.js');
const { checkRateLimit: checkRateLimitImport } = await import('../_lib/rateLimit.js');
/** @type {any} */
const handler = handlerImport;
/** @type {any} */
const checkRateLimit = checkRateLimitImport;

/** res 목 객체 팩토리 */
function makeRes() {
  return /** @type {any} */ ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  });
}

/** Kakao 카테고리 검색 성공 응답 팩토리
 * @param {number} totalCount
 */
function kakaoCategory(totalCount) {
  return {
    ok: true,
    json: () => Promise.resolve({ meta: { total_count: totalCount } }),
  };
}

/** Kakao 키워드 검색 성공 응답 (공원) 팩토리
 * @param {number} totalCount
 */
function kakaoPark(totalCount) {
  return {
    ok: true,
    json: () => Promise.resolve({ meta: { total_count: totalCount } }),
  };
}

/** Kakao 지하철 검색 성공 응답 팩토리
 * @param {number} distance
 */
function kakaoSubway(distance) {
  return {
    ok: true,
    json: () => Promise.resolve({
      meta: { total_count: 1 },
      documents: [{ distance: String(distance) }],
    }),
  };
}

describe('kakao/infra handler', () => {
  // 에러: POST 이외 메서드
  it('POST가 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: KAKAO_KEY 미설정
  it('KAKAO_KEY 미설정 시 500을 반환한다', async () => {
    delete process.env.KAKAO_KEY;
    const res = makeRes();
    await handler({ method: 'POST', body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    process.env.KAKAO_KEY = 'test-kakao-key';
  });

  // 에러: apartments 배열 누락
  it('apartments가 배열이 아니면 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { apartments: 'not-array' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 정상: 모든 카테고리 카운트 수집
  it('모든 카테고리 카운트와 지하철 거리를 수집한다', async () => {
    // 9개 API 호출: hospital, mart, conv, cafe, culture, bank, pharmacy, park, subway
    mockFetch
      .mockResolvedValueOnce(kakaoCategory(3))  // hospital
      .mockResolvedValueOnce(kakaoCategory(2))  // mart
      .mockResolvedValueOnce(kakaoCategory(10)) // conv
      .mockResolvedValueOnce(kakaoCategory(5))  // cafe
      .mockResolvedValueOnce(kakaoCategory(1))  // culture
      .mockResolvedValueOnce(kakaoCategory(4))  // bank
      .mockResolvedValueOnce(kakaoCategory(6))  // pharmacy
      .mockResolvedValueOnce(kakaoPark(2))      // park
      .mockResolvedValueOnce(kakaoSubway(500)); // subway
    const res = makeRes();
    const req = { method: 'POST', body: { apartments: [{ id: 'apt-1', lat: 37.5, lng: 127.0 }] } };
    await handler(req, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data['apt-1']).toEqual({
      hospital: 3,
      mart: 2,
      conv: 10,
      cafe: 5,
      culture: 1,
      bank: 4,
      pharmacy: 6,
      park: 2,
      subwayDist: 500,
    });
  });

  // 에러: 개별 API 실패 시 기본값 사용
  it('개별 카테고리 API 실패 시 기본값을 사용한다', async () => {
    // 모든 API 실패
    mockFetch.mockRejectedValue(new Error('API error'));
    const res = makeRes();
    const req = { method: 'POST', body: { apartments: [{ id: 'apt-1', lat: 37.5, lng: 127.0 }] } };
    await handler(req, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data['apt-1'].hospital).toBe(0);
    expect(data['apt-1'].subwayDist).toBe(9999);
    expect(data['apt-1'].park).toBe(0);
  });

  // 정상: 지하철 없을 때 9999
  it('주변에 지하철이 없으면 9999를 반환한다', async () => {
    // 8개 카테고리 성공 + 지하철 없음
    for (let i = 0; i < 8; i++) mockFetch.mockResolvedValueOnce(kakaoCategory(0));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ meta: { total_count: 0 }, documents: [] }),
    });
    const res = makeRes();
    const req = { method: 'POST', body: { apartments: [{ id: 'apt-1', lat: 37.5, lng: 127.0 }] } };
    await handler(req, res);
    expect(res.json.mock.calls[0][0].data['apt-1'].subwayDist).toBe(9999);
  });

  // 캐시 헤더 확인
  it('Cache-Control 헤더를 설정한다', async () => {
    for (let i = 0; i < 9; i++) mockFetch.mockResolvedValueOnce(kakaoCategory(0));
    const res = makeRes();
    await handler({ method: 'POST', body: { apartments: [{ id: 'a', lat: 37, lng: 127 }] } }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=86400'));
  });

  it('rejects apartments without coordinates', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { apartments: [{ id: 'apt-1' }] } }, res);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects apartments with out-of-range coordinates', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { apartments: [{ id: 'apt-1', lat: 91, lng: 127 }] } }, res);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 429 before upstream calls when proxy rate limit is exceeded', async () => {
    checkRateLimit.mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();

    await handler({ method: 'POST', headers: {}, body: { apartments: [{ id: 'apt-1', lat: 37, lng: 127 }] } }, res);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '300');
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
