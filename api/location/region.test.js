// @vitest-environment node
/**
 * location/region.js 테스트 — 좌표 검증, GPS→IP 폴백, CORS
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.KAKAO_KEY = 'test-kakao-key';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// fetch 모킹
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { default: handler } = await import('./region.js');

/** res 목 객체 팩토리 */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    end: vi.fn(),
  };
}

/** req 목 객체 팩토리 */
function makeReq(query = {}, headers = {}) {
  return {
    method: 'GET',
    query,
    headers: { origin: 'http://localhost:3000', ...headers },
    socket: { remoteAddress: '1.2.3.4' },
  };
}

/** Kakao 역지오코딩 성공 응답 팩토리 */
function kakaoOk(region1, region2) {
  return {
    ok: true,
    json: () => Promise.resolve({
      documents: [{ region_type: 'H', region_1depth_name: region1, region_2depth_name: region2 }],
    }),
  };
}

describe('location/region handler', () => {
  // 에러: KAKAO_KEY 미설정
  it('KAKAO_KEY 미설정 시 500을 반환한다', async () => {
    delete process.env.KAKAO_KEY;
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    process.env.KAKAO_KEY = 'test-kakao-key';
  });

  // 정상: OPTIONS preflight
  it('OPTIONS 요청 시 204를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', query: {}, headers: { origin: 'http://localhost:3000' }, socket: {} }, res);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  // 정상: GPS 좌표로 Kakao 역지오코딩
  it('lat/lng 파라미터로 Kakao 역지오코딩을 수행한다', async () => {
    mockFetch.mockResolvedValueOnce(kakaoOk('경기도', '화성시'));
    const res = makeRes();
    await handler(makeReq({ lat: '37.2', lng: '127.0' }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      region: '경기',
      gu: '화성시',
      method: 'gps',
    }));
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=3600'));
  });

  // 에러: 잘못된 좌표 범위
  it('좌표 범위를 벗어나면 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ lat: '91', lng: '127' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('경도 범위를 벗어나면 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ lat: '37', lng: '181' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 숫자가 아닌 좌표
  it('숫자가 아닌 좌표는 400을 반환한다', async () => {
    const res = makeRes();
    await handler(makeReq({ lat: 'abc', lng: '127' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 정상: GPS 실패 시 IP 폴백
  it('GPS 실패 시 IP 기반 위치를 사용한다', async () => {
    // Kakao 역지오코딩 실패 (documents 빈 배열)
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ documents: [] }) }) // GPS Kakao 실패
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ region: '경기도', city: '수원시', latitude: 37.26, longitude: 127.03 }) }) // ipapi
      .mockResolvedValueOnce(kakaoOk('경기도', '수원시')); // IP좌표 Kakao
    const res = makeRes();
    await handler(makeReq({ lat: '37.2', lng: '127.0' }, { 'x-forwarded-for': '203.0.113.1' }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      method: 'ip',
    }));
  });

  // 에러: 좌표 없고 IP가 localhost
  it('좌표 없고 IP가 localhost이면 에러를 반환한다', async () => {
    const res = makeRes();
    const req = makeReq({}, { 'x-forwarded-for': '127.0.0.1' });
    req.socket = { remoteAddress: '127.0.0.1' };
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, method: 'none' }));
  });

  // CORS: 허용된 origin
  it('허용된 origin에 CORS 헤더를 설정한다', async () => {
    mockFetch.mockResolvedValueOnce(kakaoOk('서울특별시', '강남구'));
    const res = makeRes();
    await handler(makeReq({ lat: '37.5', lng: '127.0' }, { origin: 'http://localhost:3000' }), res);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:3000');
  });

  // CORS: 허용되지 않은 origin
  it('허용되지 않은 origin에는 CORS 헤더를 설정하지 않는다', async () => {
    mockFetch.mockResolvedValueOnce(kakaoOk('서울특별시', '강남구'));
    const res = makeRes();
    await handler(makeReq({ lat: '37.5', lng: '127.0' }, { origin: 'https://evil.com' }), res);
    // setHeader는 Cache-Control만 호출되어야 함 (CORS 아님)
    const corsCall = res.setHeader.mock.calls.find(c => c[0] === 'Access-Control-Allow-Origin');
    expect(corsCall).toBeUndefined();
  });

  // 에러: fetch 에러 → 502
  it('외부 API 에러 시 502를 반환한다', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const res = makeRes();
    await handler(makeReq({ lat: '37.5', lng: '127.0' }), res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
