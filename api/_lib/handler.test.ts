// @vitest-environment node
/**
 * handler.js 테스트 — withHandler 래퍼의 CORS, Method, RateLimit, Admin Auth 통합 검증
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- 모킹 ---
vi.mock("./cors.js", () => ({
  handleCors: vi.fn().mockReturnValue(false),
}));

vi.mock("./rateLimit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock("./adminAuth.js", () => ({
  verifyAdminToken: vi.fn().mockReturnValue(null),
}));

const { withHandler } = await import("./handler.js");
const corsMod = await import("./cors.js");
const rateLimitMod = await import("./rateLimit.js");
const adminAuthMod = await import("./adminAuth.js");
const handleCors = vi.mocked(corsMod.handleCors);
const checkRateLimit = vi.mocked(rateLimitMod.checkRateLimit);
const verifyAdminToken = vi.mocked(adminAuthMod.verifyAdminToken);

beforeEach(() => vi.clearAllMocks());

/** res 목 객체 팩토리 */
function makeRes(): any {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    end: vi.fn(),
  };
}

/** req 목 객체 팩토리 */
function makeReq(method: string): any {
  return { method };
}

describe("withHandler", () => {
  // --- CORS ---

  // cors 미설정 시 handleCors 호출 안 함
  it("config.cors 생략 시 handleCors를 호출하지 않는다", async () => {
    const inner = vi.fn();
    const handler = withHandler({ method: "GET", handler: inner });
    await handler(makeReq("GET"), makeRes());
    expect(handleCors).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalled();
  });

  // cors: {} → handleCors 호출 + methods 자동 생성
  it("config.cors = {} 시 handleCors를 올바른 methods로 호출한다", async () => {
    const inner = vi.fn();
    const handler = withHandler({ method: "POST", cors: {}, handler: inner });
    await handler(makeReq("POST"), makeRes());
    expect(handleCors).toHaveBeenCalledWith(
      { method: "POST" },
      expect.anything(),
      expect.objectContaining({ methods: "POST, OPTIONS" })
    );
  });

  // cors: { maxAge: 86400 } → maxAge 전달
  it("config.cors 옵션(maxAge)이 handleCors에 전달된다", async () => {
    const handler = withHandler({ method: "POST", cors: { maxAge: 86400 }, handler: vi.fn() as any });
    await handler(makeReq("POST"), makeRes());
    expect(handleCors).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ methods: "POST, OPTIONS", maxAge: 86400 })
    );
  });

  // CORS preflight (handleCors returns true) → 핸들러 미호출
  it("handleCors가 true 반환 시 핸들러를 호출하지 않는다", async () => {
    handleCors.mockReturnValueOnce(true);
    const inner = vi.fn();
    const handler = withHandler({ method: "POST", cors: {}, handler: inner });
    const res = makeRes();
    await handler(makeReq("OPTIONS"), res);
    expect(inner).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // 멀티 메서드 → CORS methods 문자열 정확성
  it("method: ['GET','POST'] 시 CORS methods가 'GET, POST, OPTIONS'이다", async () => {
    const handler = withHandler({ method: ["GET", "POST"], cors: {}, handler: vi.fn() as any });
    await handler(makeReq("GET"), makeRes());
    expect(handleCors).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ methods: "GET, POST, OPTIONS" })
    );
  });

  // --- Method check ---

  // 허용되지 않은 메서드 → 405
  it("허용되지 않은 메서드는 405를 반환한다", async () => {
    const handler = withHandler({ method: "POST", handler: vi.fn() as any });
    const res = makeRes();
    await handler(makeReq("GET"), res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "Method not allowed" });
  });

  // cors 미설정 + OPTIONS → 405 (CORS 스킵이므로 method check에서 거부)
  it("config.cors 미설정 + OPTIONS 요청은 405를 반환한다", async () => {
    const handler = withHandler({ method: "POST", handler: vi.fn() as any });
    const res = makeRes();
    await handler(makeReq("OPTIONS"), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // --- Rate Limit ---

  // rateLimit 설정 + 제한됨 → 429
  it("레이트 리밋 초과 시 429를 반환한다", async () => {
    checkRateLimit.mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const inner = vi.fn();
    const handler = withHandler({ method: "POST", rateLimit: "login", handler: inner });
    const res = makeRes();
    await handler(makeReq("POST"), res);
    expect(checkRateLimit).toHaveBeenCalledWith({ method: "POST" }, "login");
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "300");
    expect(res.status).toHaveBeenCalledWith(429);
    expect(inner).not.toHaveBeenCalled();
  });

  // rateLimit 미설정 → checkRateLimit 호출 안 함
  it("config.rateLimit 생략 시 checkRateLimit를 호출하지 않는다", async () => {
    const handler = withHandler({ method: "GET", handler: vi.fn() as any });
    await handler(makeReq("GET"), makeRes());
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  // --- Admin Auth ---

  // admin: true + 인증 실패 → 401
  it("admin 인증 실패 시 401을 반환한다", async () => {
    verifyAdminToken.mockResolvedValueOnce(null);
    const inner = vi.fn();
    const handler = withHandler({ method: "GET", admin: true, handler: inner });
    const res = makeRes();
    await handler(makeReq("GET"), res);
    expect(verifyAdminToken).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "관리자 인증이 필요합니다" });
    expect(inner).not.toHaveBeenCalled();
  });

  // admin 미설정 → verifyAdminToken 호출 안 함
  it("config.admin 생략 시 verifyAdminToken를 호출하지 않는다", async () => {
    const handler = withHandler({ method: "GET", handler: vi.fn() as any });
    await handler(makeReq("GET"), makeRes());
    expect(verifyAdminToken).not.toHaveBeenCalled();
  });

  // --- Dispatch ---

  // 단일 핸들러 함수 디스패치
  it("handler가 함수이면 req, res를 전달하여 호출한다", async () => {
    const inner = vi.fn();
    const req = makeReq("POST");
    const res = makeRes();
    const handler = withHandler({ method: "POST", handler: inner });
    await handler(req, res);
    expect(inner).toHaveBeenCalledWith(req, res);
  });

  // 메서드별 객체 디스패치
  it("handler가 객체이면 req.method에 맞는 핸들러를 호출한다", async () => {
    const getHandler = vi.fn();
    const postHandler = vi.fn();
    const handler = withHandler({
      method: ["GET", "POST"],
      handler: { GET: getHandler, POST: postHandler },
    });

    const reqGet = makeReq("GET");
    const resGet = makeRes();
    await handler(reqGet, resGet);
    expect(getHandler).toHaveBeenCalledWith(reqGet, resGet);
    expect(postHandler).not.toHaveBeenCalled();

    vi.clearAllMocks();

    const reqPost = makeReq("POST");
    const resPost = makeRes();
    await handler(reqPost, resPost);
    expect(postHandler).toHaveBeenCalledWith(reqPost, resPost);
    expect(getHandler).not.toHaveBeenCalled();
  });

  // 최종 안전망 (세션 465) — 핸들러 reject 가 비JSON crash 500 으로 새지 않고 표준 JSON 500
  it("handler가 throw/reject 하면 { ok:false } 500 JSON 을 반환한다", async () => {
    const inner = vi.fn().mockRejectedValue(new Error("boom"));
    const res = makeRes();
    const handler = withHandler({ method: "POST", handler: inner });
    await handler(makeReq("POST"), res); // throw 없이 resolve 되어야 함
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "서버 오류가 발생했습니다" });
  });

  it("이미 응답이 나간 뒤(headersSent) throw 하면 이중 응답을 시도하지 않는다", async () => {
    const res = makeRes();
    res.headersSent = true;
    const inner = vi.fn(async () => {
      throw new Error("late boom");
    });
    const handler = withHandler({ method: "POST", handler: inner });
    await handler(makeReq("POST"), res);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });
});
