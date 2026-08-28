// @vitest-environment node
/**
 * auth/kakao-consent.ts 테스트 — 마케팅 수신 동의 저장 (세션 427)
 * - POST 외 메서드 405
 * - token/consent 검증
 * - 유효 토큰 + consent=true → user 갱신 + users:consent_marketing sadd
 * - consent=false → srem (집합에서 제거)
 * - 존재하지 않는 사용자 404
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-key-for-auth";
  vi.clearAllMocks();
});

vi.mock("../_lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

const mockKv = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue("OK"),
  sadd: vi.fn().mockResolvedValue(1),
  srem: vi.fn().mockResolvedValue(1),
};
vi.mock("../_lib/redis.js", () => ({ kv: mockKv }));

const { default: handler } = await import("./kakao-consent.js");
const { createToken } = await import("../_lib/auth.js");

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as any;
}

/**
 * KV 순서: isBlacklisted(bl:) → null(블랙 아님), user 조회(user:) → userData.
 * 세션 534 S1 로 blacklist 확인이 user 조회 앞에 추가된 이후 정상 흐름은 이 순서를 채운다.
 */
function mockNotBlacklistedThenUser(userData: any) {
  mockKv.get.mockResolvedValueOnce(null);
  mockKv.get.mockResolvedValueOnce(userData);
}

describe("auth/kakao-consent handler", () => {
  it("POST가 아닌 메서드는 405를 반환한다", async () => {
    const res = makeRes();
    await handler({ method: "GET", body: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("token이 없으면 400", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: { consent: true }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("consent가 boolean이 아니면 400", async () => {
    const token = createToken({ email: "kakao@test.com" });
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: "yes" }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("유효하지 않은 토큰은 401", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: { token: "garbage.token.here", consent: true }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("존재하지 않는 사용자는 404", async () => {
    const token = createToken({ email: "ghost@test.com" });
    mockNotBlacklistedThenUser(null);
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: true }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // 세션 534 S1: 로그아웃/강제 로그아웃된 토큰은 401
  it("블랙리스트된 토큰은 401 (동의 변경 차단)", async () => {
    const token = createToken({ email: "kakao@test.com" });
    mockKv.get.mockResolvedValueOnce(1); // isBlacklisted → true
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: true }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "로그아웃된 토큰입니다" }));
    // 블랙리스트에서 차단 → user 조회·set 미도달
    expect(mockKv.set).not.toHaveBeenCalled();
    expect(mockKv.sadd).not.toHaveBeenCalled();
  });

  it("consent=true → user 갱신 + consent_marketing 집합 추가", async () => {
    const token = createToken({ email: "kakao@test.com" });
    mockNotBlacklistedThenUser({ email: "kakao@test.com", name: "Tester", consentMarketing: null });
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: true }, headers: {} }, res);
    expect(mockKv.set).toHaveBeenCalledWith("user:kakao@test.com", expect.objectContaining({
      consentMarketing: true,
    }));
    expect(mockKv.sadd).toHaveBeenCalledWith("users:consent_marketing", "kakao@test.com");
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it("consent=false → user 갱신 + consent_marketing 집합 제거", async () => {
    const token = createToken({ email: "kakao@test.com" });
    mockNotBlacklistedThenUser({ email: "kakao@test.com", name: "Tester", consentMarketing: null });
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: false }, headers: {} }, res);
    expect(mockKv.set).toHaveBeenCalledWith("user:kakao@test.com", expect.objectContaining({
      consentMarketing: false,
    }));
    expect(mockKv.srem).toHaveBeenCalledWith("users:consent_marketing", "kakao@test.com");
    expect(mockKv.sadd).not.toHaveBeenCalled();
  });

  it("이메일 대소문자/공백은 정규화하여 조회한다", async () => {
    const token = createToken({ email: "  Kakao@TEST.com  " });
    mockNotBlacklistedThenUser({ email: "kakao@test.com", name: "Tester" });
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: true }, headers: {} }, res);
    expect(mockKv.get).toHaveBeenCalledWith("user:kakao@test.com");
  });

  it("sadd 실패 시 500을 반환한다 (해시 미변경)", async () => {
    const token = createToken({ email: "kakao@test.com" });
    mockNotBlacklistedThenUser({ email: "kakao@test.com", name: "Tester", consentMarketing: null });
    mockKv.sadd.mockRejectedValueOnce(new Error("Redis error"));
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: true }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    // 집합 먼저라 실패 시 해시(kv.set)는 호출되지 않아야 함 (부분 쓰기 방지 = 순서 계약)
    expect(mockKv.set).not.toHaveBeenCalled();
  });

  it("srem 실패 시 500을 반환한다 (해시 미변경)", async () => {
    const token = createToken({ email: "kakao@test.com" });
    mockNotBlacklistedThenUser({ email: "kakao@test.com", name: "Tester", consentMarketing: true });
    mockKv.srem.mockRejectedValueOnce(new Error("Redis error"));
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: false }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockKv.set).not.toHaveBeenCalled();
  });
});
