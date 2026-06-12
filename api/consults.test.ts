// @vitest-environment node
/**
 * consults.ts 테스트 — 상담 신청 POST/GET, 검증, 인증, 레이트 리밋
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- 모킹 ---
vi.mock("./_lib/cors.js", () => ({
  handleCors: vi.fn().mockReturnValue(false),
}));

vi.mock("./_lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock("./_lib/auth.js", () => ({
  verifyToken: vi.fn().mockReturnValue(null),
}));

vi.mock("./_lib/tokenBlacklist.js", () => ({
  isBlacklisted: vi.fn().mockResolvedValue(false),
}));

// Supabase chainable mock
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
const mockSelect = vi.fn().mockReturnValue({ order: mockOrder });

vi.mock("./_lib/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: vi.fn(() => ({ insert: mockInsert })) })),
  getMibuyangSupabase: vi.fn(() => ({ from: vi.fn(() => ({ select: mockSelect })) })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockLimit.mockResolvedValue({ data: [], error: null, count: 0 });
});

const { default: handlerImport } = await import("./consults.js");
const { handleCors } = await import("./_lib/cors.js");
const { checkRateLimit } = await import("./_lib/rateLimit.js");
const { verifyToken } = await import("./_lib/auth.js");
const handler = handlerImport as any;

/** res 목 객체 팩토리 */
function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() } as any;
}

/** 유효한 상담 신청 데이터 팩토리 */
function makeBody(overrides: Record<string, any> = {}) {
  return {
    name: "홍길동",
    phone: "010-1234-5678",
    interestedApts: ["apt-1", "apt-2"],
    budgetMin: "30000",
    budgetMax: "50000",
    consultType: "방문상담",
    message: "상담 희망합니다",
    ...overrides,
  };
}

/** POST 요청 팩토리 — 반복 인라인 제거 */
function makePostReq(bodyOverrides: Record<string, any> = {}) {
  return { method: "POST", headers: {}, body: makeBody(bodyOverrides) };
}

/** snake_case DB 응답 팩토리 — GET 테스트용 */
function makeConsultRow(overrides: Record<string, any> = {}) {
  return {
    id: 1, name: "홍길동", phone: "010-1234-5678",
    interested_apts: ["apt-1"], budget_min: 30000, budget_max: 50000,
    consult_type: "방문상담", message: "테스트",
    status: "pending", submitted_at: "2026-03-20T00:00:00Z",
    ...overrides,
  };
}

describe("consults handler", () => {
  // CORS 위임 확인
  it("OPTIONS 시 handleCors가 처리하고 즉시 반환한다", async () => {
    (handleCors as any).mockReturnValueOnce(true);
    const res = makeRes();
    await handler({ method: "OPTIONS", headers: {}, body: {} }, res);
    expect(handleCors).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // --- POST 검증 에러 ---
  it("POST: 이름 미입력 시 400을 반환한다", async () => {
    const res = makeRes();
    await handler(makePostReq({ name: "" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("POST: 이름 50자 초과 시 400을 반환한다", async () => {
    const res = makeRes();
    await handler(makePostReq({ name: "가".repeat(51) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("POST: 잘못된 연락처 형식은 400을 반환한다", async () => {
    const res = makeRes();
    await handler(makePostReq({ phone: "abc" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("POST: 잘못된 상담 유형은 400을 반환한다", async () => {
    const res = makeRes();
    await handler(makePostReq({ consultType: "직접방문" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("POST: interestedApts가 배열이 아니면 400을 반환한다", async () => {
    const res = makeRes();
    await handler(makePostReq({ interestedApts: "apt-1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("POST: 예산 최소값이 최대값보다 크면 400을 반환한다", async () => {
    const res = makeRes();
    await handler(makePostReq({ budgetMin: "50000", budgetMax: "30000" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // --- POST 레이트 리밋 ---
  it("POST: 레이트 리밋 초과 시 429를 반환한다", async () => {
    (checkRateLimit as any).mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "300");
  });

  // --- POST 성공/에러 ---
  it("POST: 정상 상담 신청 시 201을 반환한다", async () => {
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it("POST: Supabase 저장 실패 시 500을 반환한다", async () => {
    mockInsert.mockResolvedValueOnce({ error: new Error("DB error") });
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // --- GET 인증 ---
  it("GET: 인증 헤더 없이 요청 시 401을 반환한다", async () => {
    const res = makeRes();
    await handler({ method: "GET", headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("GET: 유효하지 않은 토큰은 401을 반환한다", async () => {
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer bad-token" }, query: {} }, res);
    expect(verifyToken).toHaveBeenCalledWith("bad-token");
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("GET: token without role returns 403", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "user@test.com" });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer no-role-token" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("GET: user role returns 403", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "user@test.com", role: "user" });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer user-token" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("GET: 유효한 관리자 토큰으로 상담 목록을 반환한다", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "admin@test.com", role: "admin" });
    // snake_case DB 응답 목
    mockLimit.mockResolvedValueOnce({
      data: [makeConsultRow()],
      error: null,
      count: 1,
    });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer valid-token" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    // camelCase 변환 확인
    const responseData = res.json.mock.calls[0][0];
    expect(responseData.ok).toBe(true);
    expect(responseData.data[0].interestedApts).toEqual(["apt-1"]);
    expect(responseData.data[0].budgetMin).toBe(30000);
    expect(responseData.data[0].submittedAt).toBe("2026-03-20T00:00:00Z");
    expect(responseData.count).toBe(1);
  });

  // 세션 405: expert role 폐지 — 잔존 expert 토큰도 403 (관리자 단독)
  it("GET: 잔존 expert role 토큰은 403을 반환한다", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "expert@test.com", role: "expert" });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer legacy-expert-token" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("GET: Supabase 조회 실패 시 500을 반환한다", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "admin@test.com", role: "admin" });
    mockLimit.mockResolvedValueOnce({ data: null, error: new Error("DB error"), count: 0 });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer valid-token" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // --- 기타 ---
  it("지원하지 않는 메서드는 405를 반환한다", async () => {
    const res = makeRes();
    await handler({ method: "DELETE", headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
