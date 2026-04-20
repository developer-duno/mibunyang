// @vitest-environment node
/**
 * auth/kakao.js 테스트 — OAuth A/B/C 분기 + redirect_uri 화이트리스트 + ex:TTL 호환
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-key-for-auth';
  process.env.KAKAO_REST_API_KEY = 'test-kakao-key';
  vi.clearAllMocks();
});

afterEach(() => {
  delete global.fetch;
});

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// ../_lib/redis.js 모킹 (세션129 Upstash 교체)
const mockKv = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue('OK'),
};
vi.mock('../_lib/redis.js', () => ({ kv: mockKv }));

const { default: handler } = await import('./kakao.js');

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
}

/** 카카오 API 2단 fetch mock (토큰 교환 + 사용자 정보) */
function mockKakaoFetch({ tokenOk = true, userOk = true, userPayload = {} } = {}) {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({
      ok: tokenOk,
      json: async () => tokenOk
        ? { access_token: 'kakao-access-token' }
        : { error: 'invalid_grant', error_description: '카카오 거부' },
    })
    .mockResolvedValueOnce({
      ok: userOk,
      json: async () => userOk
        ? { id: 12345, kakao_account: { email: 'kakao@test.com', profile: { nickname: '테스터' } }, ...userPayload }
        : { msg: '사용자 조회 실패', code: -401 },
    });
}

const VALID_BODY = { code: 'AAAAAAAAAAAA', redirect_uri: 'http://localhost:5173/oauth/kakao/callback' };

describe('auth/kakao handler', () => {
  // 1. 메서드 검증
  it('POST가 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 2. code 없음
  it('code 없으면 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { redirect_uri: VALID_BODY.redirect_uri }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 3. redirect_uri 화이트리스트 외
  it('허용되지 않은 redirect_uri는 400을 반환한다', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      body: { code: VALID_BODY.code, redirect_uri: 'https://evil.com/oauth/kakao/callback' },
      headers: {},
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('허용되지 않은'),
    }));
  });

  // 4. 카카오 토큰 교환 실패
  it('카카오 토큰 교환 실패 시 401을 반환한다', async () => {
    mockKakaoFetch({ tokenOk: false });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // 5. C 분기: 완전 신규 카카오 사용자
  it('완전 신규 사용자는 user 생성 + ok: true (C 분기)', async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce(null); // kakao:{id} 없음
    mockKv.get.mockResolvedValueOnce(null); // user:{email} 없음
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    // user:{email} set + kakao:{id} set (TTL 90일)
    expect(mockKv.set).toHaveBeenCalledWith('user:kakao@test.com', expect.objectContaining({
      kakaoId: '12345',
      status: 'approved',
    }));
  });

  // 6. A 분기: kakaoId 기존 사용자
  it('기존 카카오 사용자는 재조회 + ok: true (A 분기)', async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce('kakao@test.com'); // kakao:{id} → email
    mockKv.get.mockResolvedValueOnce({                  // user:{email}
      email: 'kakao@test.com',
      name: '테스터',
      kakaoId: '12345',
      status: 'approved',
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  // 7. B 분기: email 기존 + kakaoId 신규 연동
  it('email 기존 사용자에 kakaoId 연동 + ok: true (B 분기)', async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce(null); // kakao:{id} 없음
    mockKv.get.mockResolvedValueOnce({       // user:{email} 있음
      email: 'kakao@test.com',
      name: '기존',
      status: 'approved',
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    // kakaoId 연동 set 호출
    expect(mockKv.set).toHaveBeenCalledWith('user:kakao@test.com', expect.objectContaining({
      kakaoId: '12345',
    }));
  });

  // 8. ex:TTL 호환 — Upstash SetCommandOptions.ex 회귀 방지 (세션128 실증)
  it('kakao:{id} 역참조 set 시 ex: 7776000 TTL 호출', async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce(null);
    mockKv.get.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY, headers: {} }, res);
    expect(mockKv.set).toHaveBeenCalledWith(
      'kakao:12345',
      'kakao@test.com',
      expect.objectContaining({ ex: 90 * 24 * 60 * 60 }),
    );
  });

  // 9. status=rejected → 403
  it('status=rejected 사용자는 403을 반환한다', async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce('kakao@test.com');
    mockKv.get.mockResolvedValueOnce({
      email: 'kakao@test.com',
      name: '거부됨',
      status: 'rejected',
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
