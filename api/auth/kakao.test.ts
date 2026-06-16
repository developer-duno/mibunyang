// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-key-for-auth";
  process.env.KAKAO_REST_API_KEY = "test-kakao-key";
  vi.clearAllMocks();
});

afterEach(() => {
  delete (global as any).fetch;
  delete process.env.KAKAO_CLIENT_SECRET;
  delete process.env.KAKAO_ALLOWED_ORIGINS;
});

vi.mock("../_lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

const mockKv = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue("OK"),
  sadd: vi.fn().mockResolvedValue(1),
};
vi.mock("../_lib/redis.js", () => ({ kv: mockKv }));

const { default: handler } = await import("./kakao.js");

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as any;
}

function mockKakaoFetch({ tokenOk = true, userOk = true, userPayload = {} } = {}) {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({
      ok: tokenOk,
      json: async () => tokenOk
        ? { access_token: "kakao-access-token" }
        : { error: "invalid_grant", error_description: "denied" },
    })
    .mockResolvedValueOnce({
      ok: userOk,
      json: async () => userOk
        ? { id: 12345, kakao_account: { email: "kakao@test.com", profile: { nickname: "Tester" } }, ...userPayload }
        : { msg: "user lookup failed", code: -401 },
    }) as any;
}

const VALID_BODY = { code: "AAAAAAAAAAAA", redirect_uri: "http://localhost:5173/oauth/kakao/callback" };

describe("auth/kakao handler", () => {
  it("rejects non-POST methods", async () => {
    const res = makeRes();
    await handler({ method: "GET", body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("rejects missing code", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: { redirect_uri: VALID_BODY.redirect_uri }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects redirect_uri origins outside the allowlist", async () => {
    const res = makeRes();
    await handler({
      method: "POST",
      body: { code: VALID_BODY.code, redirect_uri: "https://evil.com/oauth/kakao/callback" },
      headers: {},
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("allows redirect_uri origins configured by KAKAO_ALLOWED_ORIGINS", async () => {
    process.env.KAKAO_ALLOWED_ORIGINS = "https://preview.example.com, https://staging.example.com";
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce(null);
    mockKv.get.mockResolvedValueOnce(null);
    const res = makeRes();

    await handler({
      method: "POST",
      body: { code: VALID_BODY.code, redirect_uri: "https://staging.example.com/oauth/kakao/callback" },
      headers: {},
    }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("rejects configured origins when the callback path is different", async () => {
    process.env.KAKAO_ALLOWED_ORIGINS = "https://staging.example.com";
    global.fetch = vi.fn() as any;
    const res = makeRes();

    await handler({
      method: "POST",
      body: { code: VALID_BODY.code, redirect_uri: "https://staging.example.com/oauth/kakao/other" },
      headers: {},
    }, res);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 401 when Kakao token exchange fails", async () => {
    mockKakaoFetch({ tokenOk: false });
    const res = makeRes();
    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 500 before token exchange when KAKAO_REST_API_KEY is missing", async () => {
    delete process.env.KAKAO_REST_API_KEY;
    global.fetch = vi.fn() as any;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();

    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    consoleError.mockRestore();
  });

  it("includes optional KAKAO_CLIENT_SECRET in the token exchange body", async () => {
    process.env.KAKAO_CLIENT_SECRET = "test-client-secret";
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce(null);
    mockKv.get.mockResolvedValueOnce(null);
    const res = makeRes();

    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);

    const tokenRequestBody = (global.fetch as any).mock.calls[0][1].body;
    expect(tokenRequestBody).toContain("client_id=test-kakao-key");
    expect(tokenRequestBody).toContain("client_secret=test-client-secret");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("creates a new Kakao user when neither kakao id nor email exists", async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce(null);
    mockKv.get.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(mockKv.set).toHaveBeenCalledWith("user:kakao@test.com", expect.objectContaining({
      kakaoId: "12345",
      status: "approved",
      consentMarketing: null,  // 세션 427: 신규는 미선택 → 동의 모달 신호
      phoneNumber: null,       // 세션 427: 비즈앱 심사 전 null
    }));
    // 회귀 가드: admin 통계의 진실의 원천인 users:{status} set 동기화 누락 방지
    expect(mockKv.sadd).toHaveBeenCalledWith("users:approved", "kakao@test.com");
  });

  it("신규 가입 시 needsMarketingConsent=true + isNew=true 응답 (세션 427)", async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce(null);
    mockKv.get.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      isNew: true,
      needsMarketingConsent: true,
    }));
  });

  it("카카오 phone_number 응답 시 신규 사용자에 phoneNumber 저장 (비즈앱 심사 후, 세션 427)", async () => {
    mockKakaoFetch({ userPayload: { kakao_account: { email: "kakao@test.com", profile: { nickname: "Tester" }, phone_number: "+82 10-1234-5678" } } });
    mockKv.get.mockResolvedValueOnce(null);
    mockKv.get.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);
    expect(mockKv.set).toHaveBeenCalledWith("user:kakao@test.com", expect.objectContaining({
      phoneNumber: "+82 10-1234-5678",
    }));
  });

  it("기존 사용자 phoneNumber 없을 때 카카오 phone 새로 받으면 채움 (심사 후 재로그인, 세션 427)", async () => {
    mockKakaoFetch({ userPayload: { kakao_account: { email: "kakao@test.com", profile: { nickname: "Tester" }, phone_number: "+82 10-9999-8888" } } });
    mockKv.get.mockResolvedValueOnce("kakao@test.com");
    mockKv.get.mockResolvedValueOnce({
      email: "kakao@test.com", name: "Tester", kakaoId: "12345", status: "approved",
      consentMarketing: true, phoneNumber: null,
    });
    const res = makeRes();
    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);
    expect(mockKv.set).toHaveBeenCalledWith("user:kakao@test.com", expect.objectContaining({
      phoneNumber: "+82 10-9999-8888",
    }));
    // 이미 동의 선택한 기존 사용자는 동의 모달 미표시
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ needsMarketingConsent: false }));
  });

  it("reuses an existing Kakao-linked user", async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce("kakao@test.com");
    mockKv.get.mockResolvedValueOnce({
      email: "kakao@test.com",
      name: "Tester",
      kakaoId: "12345",
      status: "approved",
    });
    const res = makeRes();
    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("links an existing email user to Kakao id", async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce(null);
    mockKv.get.mockResolvedValueOnce({
      email: "kakao@test.com",
      name: "Existing",
      status: "approved",
    });
    const res = makeRes();
    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(mockKv.set).toHaveBeenCalledWith("user:kakao@test.com", expect.objectContaining({
      kakaoId: "12345",
    }));
  });

  it("stores kakao id lookup with a 90 day TTL", async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce(null);
    mockKv.get.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);
    expect(mockKv.set).toHaveBeenCalledWith(
      "kakao:12345",
      "kakao@test.com",
      expect.objectContaining({ ex: 90 * 24 * 60 * 60 }),
    );
  });

  it("rejects rejected users", async () => {
    mockKakaoFetch();
    mockKv.get.mockResolvedValueOnce("kakao@test.com");
    mockKv.get.mockResolvedValueOnce({
      email: "kakao@test.com",
      name: "Rejected",
      status: "rejected",
    });
    const res = makeRes();
    await handler({ method: "POST", body: VALID_BODY, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
