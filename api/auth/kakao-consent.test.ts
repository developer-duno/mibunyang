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
    mockKv.get.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: true }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("consent=true → user 갱신 + consent_marketing 집합 추가", async () => {
    const token = createToken({ email: "kakao@test.com" });
    mockKv.get.mockResolvedValueOnce({ email: "kakao@test.com", name: "Tester", consentMarketing: null });
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
    mockKv.get.mockResolvedValueOnce({ email: "kakao@test.com", name: "Tester", consentMarketing: null });
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
    mockKv.get.mockResolvedValueOnce({ email: "kakao@test.com", name: "Tester" });
    const res = makeRes();
    await handler({ method: "POST", body: { token, consent: true }, headers: {} }, res);
    expect(mockKv.get).toHaveBeenCalledWith("user:kakao@test.com");
  });
});
