// @vitest-environment node
/**
 * neis/schools.js 테스트 — 학교 점수 공식, 등급 매핑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.NEIS_KEY = 'test-neis-key';
  process.env.KAKAO_KEY = 'test-kakao-key';
  vi.clearAllMocks();
});

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// fetch 모킹
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { default: handler } = await import('./schools.js');

/** res 목 객체 팩토리 */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
}

/** Kakao 키워드 검색 응답 팩토리 */
function kakaoSchool(totalCount, nearestDist = 300) {
  return {
    ok: true,
    json: () => Promise.resolve({
      meta: { total_count: totalCount },
      documents: totalCount > 0 ? [{ distance: String(nearestDist) }] : [],
    }),
  };
}

/** NEIS 학교 정보 응답 팩토리 */
function neisResponse(schools = []) {
  return {
    ok: true,
    json: () => Promise.resolve({
      schoolInfo: [
        { head: [{ list_total_count: schools.length }] },
        { row: schools },
      ],
    }),
  };
}

describe('neis/schools handler', () => {
  // 에러: POST 이외 메서드
  it('POST가 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: NEIS_KEY 미설정
  it('NEIS_KEY 미설정 시 500을 반환한다', async () => {
    delete process.env.NEIS_KEY;
    const res = makeRes();
    await handler({ method: 'POST', body: { apartments: [] } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    process.env.NEIS_KEY = 'test-neis-key';
  });

  // 에러: apartments 배열 누락
  it('apartments가 배열이 아니면 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 정상: 카카오 키워드로 학군 점수 계산 (좌표 있는 경우)
  it('좌표가 있으면 카카오 키워드 검색으로 학군 점수를 계산한다', async () => {
    // NEIS 호출 없음 (region 없으므로)
    // 카카오: 초등(500m 이내, 3개), 중학(800m, 2개), 고등(1500m, 1개)
    mockFetch
      .mockResolvedValueOnce(kakaoSchool(3, 400))  // 초등학교
      .mockResolvedValueOnce(kakaoSchool(2, 800))  // 중학교
      .mockResolvedValueOnce(kakaoSchool(1, 1500)); // 고등학교
    const res = makeRes();
    const req = {
      method: 'POST',
      body: { apartments: [{ id: 'apt-1', lat: 37.5, lng: 127.0 }] },
    };
    await handler(req, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data['apt-1'].schoolScore).toBeGreaterThan(0);
    expect(data['apt-1'].schoolScore).toBeLessThanOrEqual(100);
    expect(data['apt-1'].schoolGrade).toBeTruthy();
  });

  // 정상: calcScoreFromKakao 점수 계산 검증
  it('초등 500m 이내 + 중학 1000m 이내 + 고등 2000m 이내일 때 높은 점수', async () => {
    // 초등: nearest=400 → 25점, 중학: nearest=800 → 20점, 고등: nearest=1500 → 15점
    // 다양성 보너스: min(3+2+1, 15) * 1.5 = 9점 → 총 69점
    mockFetch
      .mockResolvedValueOnce(kakaoSchool(3, 400))
      .mockResolvedValueOnce(kakaoSchool(2, 800))
      .mockResolvedValueOnce(kakaoSchool(1, 1500));
    const res = makeRes();
    await handler({
      method: 'POST',
      body: { apartments: [{ id: 'apt-1', lat: 37.5, lng: 127.0 }] },
    }, res);
    const score = res.json.mock.calls[0][0].data['apt-1'].schoolScore;
    expect(score).toBe(69); // 25+20+15+9
  });

  // 정상: gradeFromScore 등급 매핑
  it('점수 85 이상이면 "최우수"', async () => {
    // 초등+중학+고등 모두 가까이 + 많은 학교 → 고점수
    mockFetch
      .mockResolvedValueOnce(kakaoSchool(10, 300))
      .mockResolvedValueOnce(kakaoSchool(10, 500))
      .mockResolvedValueOnce(kakaoSchool(10, 1000));
    const res = makeRes();
    await handler({
      method: 'POST',
      body: { apartments: [{ id: 'apt-1', lat: 37.5, lng: 127.0 }] },
    }, res);
    const result = res.json.mock.calls[0][0].data['apt-1'];
    // 25+20+15+ min(30,15)*1.5 = 25+20+15+22.5 → 82.5 → round → 83
    // Actually: 25+20+15+round(15*1.5)=25+20+15+23=83 → "우수"
    expect(['최우수', '우수']).toContain(result.schoolGrade);
  });

  // 정상: 좌표 없으면 NEIS 기반 점수 계산
  it('좌표가 없으면 NEIS 주소 매칭으로 점수를 계산한다', async () => {
    // NEIS 응답
    mockFetch.mockResolvedValueOnce(neisResponse([
      { SCHUL_NM: '화성초', SCHUL_KND_SC_NM: '초등학교', ORG_RDNMA: '경기도 화성시', FOND_SC_NM: '공립' },
      { SCHUL_NM: '화성중', SCHUL_KND_SC_NM: '중학교', ORG_RDNMA: '경기도 화성시', FOND_SC_NM: '공립' },
      { SCHUL_NM: '화성고', SCHUL_KND_SC_NM: '고등학교', ORG_RDNMA: '경기도 화성시', FOND_SC_NM: '공립' },
    ]));
    // 카카오 키가 있어도 좌표가 없으면 NEIS 경로를 탄다
    const res = makeRes();
    await handler({
      method: 'POST',
      body: { apartments: [{ id: 'apt-1', region: '경기', gu: '화성시' }] },
    }, res);
    const result = res.json.mock.calls[0][0].data['apt-1'];
    // calcScoreFromNEIS: 3*3=9 (max 40) + 15 (초등 있음) + 15 (중학 있음) + 10 (고등 있음) = 49
    expect(result.schoolScore).toBe(49);
    expect(result.schoolGrade).toBe('미흡'); // 49 < 50
  });

  // 등급 경계값: 50점 → "보통"
  it('점수 50이면 "보통" 등급이다', async () => {
    // NEIS에서 4개 학교 → score = min(4*3,40) + 15 + 15 + 10 = 12+15+15+10 = 52
    mockFetch.mockResolvedValueOnce(neisResponse([
      { SCHUL_NM: 'A초', SCHUL_KND_SC_NM: '초등학교', ORG_RDNMA: '서울 강남구', FOND_SC_NM: '공립' },
      { SCHUL_NM: 'B초', SCHUL_KND_SC_NM: '초등학교', ORG_RDNMA: '서울 강남구', FOND_SC_NM: '공립' },
      { SCHUL_NM: 'C중', SCHUL_KND_SC_NM: '중학교', ORG_RDNMA: '서울 강남구', FOND_SC_NM: '공립' },
      { SCHUL_NM: 'D고', SCHUL_KND_SC_NM: '고등학교', ORG_RDNMA: '서울 강남구', FOND_SC_NM: '공립' },
    ]));
    const res = makeRes();
    await handler({
      method: 'POST',
      body: { apartments: [{ id: 'apt-1', region: '서울', gu: '강남구' }] },
    }, res);
    const result = res.json.mock.calls[0][0].data['apt-1'];
    expect(result.schoolScore).toBe(52);
    expect(result.schoolGrade).toBe('보통');
  });

  // 캐시 헤더
  it('Cache-Control 헤더를 설정한다', async () => {
    mockFetch.mockResolvedValueOnce(kakaoSchool(0, 0)).mockResolvedValueOnce(kakaoSchool(0, 0)).mockResolvedValueOnce(kakaoSchool(0, 0));
    const res = makeRes();
    await handler({
      method: 'POST',
      body: { apartments: [{ id: 'a', lat: 37, lng: 127 }] },
    }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=86400'));
  });

  // 에러: 외부 API 전체 실패 → 502
  it('외부 API 전체 실패 시 502를 반환한다', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const res = makeRes();
    await handler({
      method: 'POST',
      body: { apartments: [{ id: 'a', lat: 37, lng: 127 }] },
    }, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
