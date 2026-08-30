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

// 세션 534 S0: requireAdminGate 가 status 재확인용으로 kv.get(user:{email}) 호출 — approved 로 통과.
vi.mock("./_lib/redis.js", () => ({
  kv: { get: vi.fn().mockResolvedValue({ status: "approved" }) },
}));

// Supabase chainable mock — handleGet: .select().order().order().range() (세션 425 페이지네이션)
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockRange = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
const mockOrder2 = vi.fn().mockReturnValue({ range: mockRange }); // id tiebreaker (2번째 order)
const mockOrder = vi.fn().mockReturnValue({ order: mockOrder2 });
const mockSelect = vi.fn().mockReturnValue({ order: mockOrder });
// handleDelete: .delete().eq()
const mockDeleteEq = vi.fn().mockResolvedValue({ error: null });
const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq });

vi.mock("./_lib/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: vi.fn(() => ({ insert: mockInsert })) })),
  getMibuyangSupabase: vi.fn(() => ({ from: vi.fn(() => ({ select: mockSelect, delete: mockDelete })) })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockRange.mockResolvedValue({ data: [], error: null, count: 0 });
  mockOrder2.mockReturnValue({ range: mockRange });
  mockOrder.mockReturnValue({ order: mockOrder2 });
  mockDeleteEq.mockResolvedValue({ error: null });
  mockDelete.mockReturnValue({ eq: mockDeleteEq });
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
    consent: true,
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
  it("POST: 개인정보 동의(consent) 없으면 400을 반환한다 (PIPA §15)", async () => {
    const res = makeRes();
    await handler(makePostReq({ consent: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "개인정보 수집·이용 동의가 필요합니다" });
  });

  it("POST: consent 가 true 가 아니면(false) 400을 반환한다", async () => {
    const res = makeRes();
    await handler(makePostReq({ consent: false }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("POST: 정상 신청 시 insert 에 consent_at 이 포함된다", async () => {
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res.status).toHaveBeenCalledWith(201);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.consent_at).toEqual(expect.any(String));
  });

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

  // --- GET/DELETE rate limit (세션 465 — 자매 admin 엔드포인트 rateLimit:"admin" 정합) ---
  it("GET: 레이트 리밋 초과 시 429를 반환한다 (인증 검사보다 먼저)", async () => {
    (checkRateLimit as any).mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();
    await handler({ method: "GET", headers: {}, query: {} }, res);
    expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "300");
  });

  it("DELETE: 레이트 리밋 초과 시 429를 반환한다", async () => {
    (checkRateLimit as any).mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();
    await handler({ method: "DELETE", headers: {}, query: { id: "1" } }, res);
    expect(res.status).toHaveBeenCalledWith(429);
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
    mockRange.mockResolvedValueOnce({
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

  // 세션 425: 페이지네이션 — offset/limit 파라미터 → range 호출 인자
  it("GET: 기본 limit 50, offset 0 → range(0, 49) 호출", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "admin@test.com", role: "admin" });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer valid-token" }, query: {} }, res);
    expect(mockRange).toHaveBeenCalledWith(0, 49);
  });

  it("GET: offset=50 → range(50, 99) 호출 (더보기 2페이지)", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "admin@test.com", role: "admin" });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer valid-token" }, query: { offset: "50" } }, res);
    expect(mockRange).toHaveBeenCalledWith(50, 99);
  });

  it("GET: limit/offset 클램프 — 음수·초과·NaN 방어", async () => {
    (verifyToken as any).mockReturnValue({ email: "admin@test.com", role: "admin" });
    // limit 상한 100 초과 → 100, offset 음수 → 0
    await handler({ method: "GET", headers: { authorization: "Bearer t" }, query: { limit: "500", offset: "-10" } }, makeRes());
    expect(mockRange).toHaveBeenLastCalledWith(0, 99);
    // limit NaN → 기본 50, offset NaN → 0
    await handler({ method: "GET", headers: { authorization: "Bearer t" }, query: { limit: "abc", offset: "xyz" } }, makeRes());
    expect(mockRange).toHaveBeenLastCalledWith(0, 49);
  });

  it("GET: count 가 null 이면 응답 count 0 으로 폴백", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "admin@test.com", role: "admin" });
    mockRange.mockResolvedValueOnce({ data: [], error: null, count: null });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer valid-token" }, query: {} }, res);
    expect(res.json.mock.calls[0][0].count).toBe(0);
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
    mockRange.mockResolvedValueOnce({ data: null, error: new Error("DB error"), count: 0 });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer valid-token" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // --- DELETE (관리자 상담 기록 파기, 세션 442) ---
  it("DELETE: 인증 헤더 없이 요청 시 401을 반환한다", async () => {
    const res = makeRes();
    await handler({ method: "DELETE", headers: {}, query: { id: "1" } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("DELETE: 비관리자(user) 토큰은 403을 반환한다", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "user@test.com", role: "user" });
    const res = makeRes();
    await handler({ method: "DELETE", headers: { authorization: "Bearer user-token" }, query: { id: "1" } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("DELETE: 관리자 + 유효 id 면 200 + delete().eq(id) 호출", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "admin@test.com", role: "admin" });
    const res = makeRes();
    await handler({ method: "DELETE", headers: { authorization: "Bearer valid-token" }, query: { id: "7" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(mockDeleteEq).toHaveBeenCalledWith("id", 7);
  });

  it("DELETE: 관리자지만 id 가 없거나 비정수면 400을 반환한다", async () => {
    (verifyToken as any).mockReturnValue({ email: "admin@test.com", role: "admin" });
    await handler({ method: "DELETE", headers: { authorization: "Bearer t" }, query: {} }, makeRes());
    expect(mockDeleteEq).not.toHaveBeenCalled();
    const res2 = makeRes();
    await handler({ method: "DELETE", headers: { authorization: "Bearer t" }, query: { id: "abc" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("DELETE: body 로 id 를 받아도 동작한다", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "admin@test.com", role: "admin" });
    const res = makeRes();
    await handler({ method: "DELETE", headers: { authorization: "Bearer valid-token" }, body: { id: 3 }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockDeleteEq).toHaveBeenCalledWith("id", 3);
  });

  it("DELETE: Supabase 삭제 실패 시 500을 반환한다", async () => {
    (verifyToken as any).mockReturnValueOnce({ email: "admin@test.com", role: "admin" });
    mockDeleteEq.mockResolvedValueOnce({ error: new Error("DB error") });
    const res = makeRes();
    await handler({ method: "DELETE", headers: { authorization: "Bearer valid-token" }, query: { id: "1" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // --- 기타 ---
  it("지원하지 않는 메서드는 405를 반환한다", async () => {
    const res = makeRes();
    await handler({ method: "PUT", headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
