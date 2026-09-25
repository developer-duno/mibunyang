// @vitest-environment node
/**
 * feedback.ts 테스트 — 손님 의견 보내기 (세션574)
 * - POST(손님): Bearer 사용자 JWT → refresh 거부 → 블랙리스트 → KV 사용자 → 차단 사용자 → 본문 검증 → 저장 → 텔레그램
 * - GET/PATCH/DELETE(관리자): requireAdminGate
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

vi.mock("./_lib/redis.js", () => ({
  kv: { get: vi.fn() },
}));

// 텔레그램은 보내는 함수만 가짜로 — 문구 만들기(formatFeedbackAlert)는 진짜를 쓴다.
vi.mock("./_lib/telegram.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./_lib/telegram.js")>();
  return { ...orig, sendTelegram: vi.fn().mockResolvedValue({ sent: true }) };
});

// Supabase chainable mock
const mockSingle = vi.fn();
const mockInsertSelect = vi.fn(() => ({ single: mockSingle }));
const mockInsert = vi.fn((_row: any) => ({ select: mockInsertSelect }));
const mockRange = vi.fn();
const mockOrder2 = vi.fn((_col: string, _opts: any) => ({ range: mockRange }));
const mockOrder = vi.fn((_col: string, _opts: any) => ({ order: mockOrder2 }));
const mockSelect = vi.fn((_cols: string, _opts?: any) => ({ order: mockOrder }));
const mockUpdateSelect = vi.fn();
const mockUpdateEq = vi.fn((_col: string, _val: any) => ({ select: mockUpdateSelect }));
const mockUpdate = vi.fn((_patch: any) => ({ eq: mockUpdateEq }));
const mockDeleteEq = vi.fn();
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }));
const mockFrom = vi.fn((_t: string) => ({
  insert: mockInsert,
  select: mockSelect,
  update: mockUpdate,
  delete: mockDelete,
}));

vi.mock("./_lib/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: vi.fn(() => ({})) })),
  getMibuyangSupabase: vi.fn(() => ({ from: mockFrom })),
}));

const { default: handlerImport } = await import("./feedback.js");
const { checkRateLimit } = await import("./_lib/rateLimit.js");
const { verifyToken } = await import("./_lib/auth.js");
const { isBlacklisted } = await import("./_lib/tokenBlacklist.js");
const { kv } = await import("./_lib/redis.js");
const { sendTelegram } = await import("./_lib/telegram.js");
const { getSupabase } = await import("./_lib/supabase.js");
const handler = handlerImport as any;

const USER = { email: "hong@example.com", name: "홍길동", status: "approved" };

beforeEach(() => {
  vi.clearAllMocks();
  (checkRateLimit as any).mockResolvedValue({ limited: false });
  (verifyToken as any).mockReturnValue(null);
  (isBlacklisted as any).mockResolvedValue(false);
  (kv.get as any).mockResolvedValue(USER);
  (sendTelegram as any).mockResolvedValue({ sent: true });
  mockSingle.mockResolvedValue({ data: { id: 7 }, error: null });
  mockRange.mockResolvedValue({ data: [], error: null, count: 0 });
  mockUpdateSelect.mockResolvedValue({ data: [{ id: 3 }], error: null });
  mockDeleteEq.mockResolvedValue({ error: null });
});

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() } as any;
}

function makeBody(overrides: Record<string, any> = {}) {
  return {
    kind: "bug",
    message: "지도 화면에서 단지 점이 안 보여요",
    consent: true,
    page: "상세",
    apartmentId: "ap-6028351",
    apartmentName: "힐스테이트테스트",
    ...overrides,
  };
}

/** 로그인 손님의 POST — verifyToken 이 사용자 페이로드를 돌려주게 해 둔다. */
function userPost(bodyOverrides: Record<string, any> = {}, headers: Record<string, string> = {}) {
  (verifyToken as any).mockReturnValue({ email: "Hong@Example.com ", name: "홍길동" });
  return {
    method: "POST",
    headers: { authorization: "Bearer user-token", "user-agent": "Mozilla/5.0 테스트", ...headers },
    body: makeBody(bodyOverrides),
  };
}

function adminReq(method: string, extra: Record<string, any> = {}) {
  (verifyToken as any).mockReturnValue({ email: "admin@test.com", role: "admin" });
  return { method, headers: { authorization: "Bearer admin-token" }, query: {}, body: {}, ...extra };
}

describe("feedback handler — 공통", () => {
  it("허용하지 않은 메서드(PUT)는 405", async () => {
    const res = makeRes();
    await handler({ method: "PUT", headers: {}, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe("feedback handler — POST(손님)", () => {
  it("레이트 리밋 초과면 429 + Retry-After (키 = feedback)", async () => {
    (checkRateLimit as any).mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();
    await handler(userPost(), res);
    expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), "feedback");
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "300");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("Authorization 헤더가 없으면 401", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: {}, body: makeBody() }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("Bearer 가 아닌 헤더도 401", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: { authorization: "Basic abc" }, body: makeBody() }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("위조·만료 토큰(verifyToken=null)은 401", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: { authorization: "Bearer forged" }, body: makeBody() }, res);
    expect(verifyToken).toHaveBeenCalledWith("forged");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "유효하지 않은 토큰입니다" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("refresh 토큰으로는 보낼 수 없다 — 401", async () => {
    const req = userPost();
    (verifyToken as any).mockReturnValue({ email: "hong@example.com", type: "refresh" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("이메일 없는 토큰은 401", async () => {
    const req = userPost();
    (verifyToken as any).mockReturnValue({ name: "익명" });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("로그아웃된(블랙리스트) 토큰은 401", async () => {
    (isBlacklisted as any).mockResolvedValueOnce(true);
    const res = makeRes();
    await handler(userPost(), res);
    expect(isBlacklisted).toHaveBeenCalledWith("user-token");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "로그아웃된 토큰입니다" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("KV 에 사용자가 없으면 401", async () => {
    (kv.get as any).mockResolvedValueOnce(null);
    const res = makeRes();
    await handler(userPost(), res);
    expect(kv.get).toHaveBeenCalledWith("user:hong@example.com");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it.each(["suspended", "rejected", "pending"])("차단된 사용자(status=%s)는 403", async (status) => {
    (kv.get as any).mockResolvedValueOnce({ ...USER, status });
    const res = makeRes();
    await handler(userPost(), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("모르는 종류(kind)는 400", async () => {
    const res = makeRes();
    await handler(userPost({ kind: "spam" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("내용이 비었거나 공백뿐이거나 문자열이 아니면 400", async () => {
    for (const message of ["", "   ", undefined, 123]) {
      const res = makeRes();
      await handler(userPost({ message }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("내용 1001자는 400, 1000자는 201", async () => {
    const res1 = makeRes();
    await handler(userPost({ message: "가".repeat(1001) }), res1);
    expect(res1.status).toHaveBeenCalledWith(400);
    expect(mockInsert).not.toHaveBeenCalled();

    const res2 = makeRes();
    await handler(userPost({ message: "가".repeat(1000) }), res2);
    expect(res2.status).toHaveBeenCalledWith(201);
  });

  it("동의(consent)가 true 가 아니면 400 — false·빠짐·문자열 'true'·1 전부", async () => {
    for (const consent of [false, undefined, "true", 1]) {
      const res = makeRes();
      await handler(userPost({ consent }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("화면·단지명이 200자를 넘거나 문자열이 아니면 400", async () => {
    for (const o of [{ page: "가".repeat(201) }, { apartmentName: "나".repeat(201) }, { page: 5 }]) {
      const res = makeRes();
      await handler(userPost(o), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("단지 id 가 ah-/ap-숫자 꼴이 아니면 400", async () => {
    for (const apartmentId of ["x-1", "ah-", "ap-12a", "../etc", 7]) {
      const res = makeRes();
      await handler(userPost({ apartmentId }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("정상 — 201 {ok,id} + 저장 칸 + 텔레그램 1회", async () => {
    const res = makeRes();
    await handler(userPost({ message: "  앞뒤 공백은 지운다  " }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true, id: 7 });

    expect(mockFrom).toHaveBeenCalledWith("site_feedback");
    const row = mockInsert.mock.calls[0][0];
    expect(row).toMatchObject({
      user_email: "hong@example.com",
      user_name: "홍길동",
      kind: "bug",
      message: "앞뒤 공백은 지운다",
      page: "상세",
      apartment_id: "ap-6028351",
      apartment_name: "힐스테이트테스트",
      user_agent: "Mozilla/5.0 테스트",
    });
    expect(row.consent_at).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(row.consent_at))).toBe(false);
    // 상태·처리 시각은 DB 기본값에 맡긴다 — 손님이 넣을 수 없다
    expect(row).not.toHaveProperty("status");
    expect(row).not.toHaveProperty("handled_at");

    expect(sendTelegram).toHaveBeenCalledTimes(1);
    const text = (sendTelegram as any).mock.calls[0][0] as string;
    expect(text.split("\n")[0]).toBe("💬 새 의견 · 버그·오류");
    expect(text).toContain("홍길동(hong@example.com)");
    expect(text).toContain("힐스테이트테스트 (ap-6028351)");
  });

  it("본문에 status·user_email 을 넣어도 무시된다(서버가 정한다)", async () => {
    const res = makeRes();
    await handler(userPost({ status: "done", user_email: "evil@x.com", userEmail: "evil@x.com" }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    const row = mockInsert.mock.calls[0][0];
    expect(row.user_email).toBe("hong@example.com");
    expect(row).not.toHaveProperty("status");
  });

  it("선택 칸(page·단지)이 없어도 201 — null 로 저장", async () => {
    const res = makeRes();
    await handler(userPost({ page: undefined, apartmentId: undefined, apartmentName: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    const row = mockInsert.mock.calls[0][0];
    expect(row).toMatchObject({ page: null, apartment_id: null, apartment_name: null });
  });

  it("user-agent 는 300자까지만 저장", async () => {
    const res = makeRes();
    await handler(userPost({}, { "user-agent": "U".repeat(500) }), res);
    expect(mockInsert.mock.calls[0][0].user_agent).toHaveLength(300);
  });

  it("텔레그램이 실패해도 201 (저장은 됐다) + 경고 로그", async () => {
    (sendTelegram as any).mockResolvedValueOnce({ sent: false, reason: "텔레그램 API 400" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = makeRes();
    await handler(userPost(), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true, id: 7 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("텔레그램 함수가 예외를 던져도 201", async () => {
    (sendTelegram as any).mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = makeRes();
    await handler(userPost(), res);
    expect(res.status).toHaveBeenCalledWith(201);
    warn.mockRestore();
  });

  it("저장 실패면 500 + 텔레그램 안 보냄", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();
    await handler(userPost(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(sendTelegram).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("저장은 service key 클라이언트로 한다 — 공개 열쇠(anon) 금지", async () => {
    const res = makeRes();
    await handler(userPost(), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(getSupabase).not.toHaveBeenCalled();
  });
});

describe("feedback handler — 관리자 GET/PATCH/DELETE", () => {
  it("GET: 인증 헤더 없으면 401", async () => {
    const res = makeRes();
    await handler({ method: "GET", headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("GET: 일반 손님(role user) 토큰은 403", async () => {
    (verifyToken as any).mockReturnValue({ email: "hong@example.com", role: "user" });
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer t" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("GET: 레이트 리밋(admin) 초과면 429", async () => {
    (checkRateLimit as any).mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();
    await handler(adminReq("GET"), res);
    expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("GET: 관리자면 목록 + count, camelCase 로 바꿔 준다", async () => {
    mockRange.mockResolvedValueOnce({
      data: [
        {
          id: 3,
          user_email: "hong@example.com",
          user_name: "홍길동",
          kind: "data",
          message: "세대수가 달라요",
          page: "상세",
          apartment_id: "ah-1",
          apartment_name: "OO단지",
          user_agent: "UA",
          status: "new",
          consent_at: "2026-09-25T00:00:00Z",
          created_at: "2026-09-25T00:00:00Z",
          handled_at: null,
        },
      ],
      error: null,
      count: 12,
    });
    const res = makeRes();
    await handler(adminReq("GET"), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      count: 12,
      data: [
        {
          id: 3,
          userEmail: "hong@example.com",
          userName: "홍길동",
          kind: "data",
          message: "세대수가 달라요",
          page: "상세",
          apartmentId: "ah-1",
          apartmentName: "OO단지",
          userAgent: "UA",
          status: "new",
          createdAt: "2026-09-25T00:00:00Z",
          handledAt: null,
        },
      ],
    });
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(mockOrder2).toHaveBeenCalledWith("id", { ascending: false });
  });

  it("GET: limit 는 50 이 상한 — limit=500 이어도 range(0,49)", async () => {
    const res = makeRes();
    await handler(adminReq("GET", { query: { limit: "500", offset: "0" } }), res);
    expect(mockRange).toHaveBeenCalledWith(0, 49);
  });

  it("GET: offset=50 → range(50,99)", async () => {
    const res = makeRes();
    await handler(adminReq("GET", { query: { offset: "50" } }), res);
    expect(mockRange).toHaveBeenCalledWith(50, 99);
  });

  it("GET: count 가 null 이면 0", async () => {
    mockRange.mockResolvedValueOnce({ data: [], error: null, count: null });
    const res = makeRes();
    await handler(adminReq("GET"), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: [], count: 0 });
  });

  it("PATCH: 헤더 없으면 401, 비관리자는 403", async () => {
    const res1 = makeRes();
    await handler({ method: "PATCH", headers: {}, body: { id: 3, status: "done" } }, res1);
    expect(res1.status).toHaveBeenCalledWith(401);
    (verifyToken as any).mockReturnValue({ email: "hong@example.com", role: "user" });
    const res2 = makeRes();
    await handler({ method: "PATCH", headers: { authorization: "Bearer t" }, body: { id: 3, status: "done" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("PATCH: done 이면 handled_at 을 채운다", async () => {
    const res = makeRes();
    await handler(adminReq("PATCH", { body: { id: 3, status: "done" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const patch = mockUpdate.mock.calls[0][0];
    expect(patch.status).toBe("done");
    expect(Number.isNaN(Date.parse(patch.handled_at))).toBe(false);
    expect(mockUpdateEq).toHaveBeenCalledWith("id", 3);
  });

  it("PATCH: new 로 되돌리면 handled_at 을 비운다", async () => {
    const res = makeRes();
    await handler(adminReq("PATCH", { body: { id: "3", status: "new" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockUpdate.mock.calls[0][0]).toEqual({ status: "new", handled_at: null });
  });

  it("PATCH: 잘못된 id·status 는 400", async () => {
    for (const body of [{ id: 0, status: "done" }, { id: "abc", status: "done" }, { id: 3, status: "deleted" }, {}]) {
      const res = makeRes();
      await handler(adminReq("PATCH", { body }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("PATCH: 없는 id 면 404", async () => {
    mockUpdateSelect.mockResolvedValueOnce({ data: [], error: null });
    const res = makeRes();
    await handler(adminReq("PATCH", { body: { id: 999, status: "done" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("DELETE: 비관리자 403 / 관리자 + ?id= 면 200 + delete().eq(id)", async () => {
    (verifyToken as any).mockReturnValue({ email: "hong@example.com", role: "user" });
    const res1 = makeRes();
    await handler({ method: "DELETE", headers: { authorization: "Bearer t" }, query: { id: "3" } }, res1);
    expect(res1.status).toHaveBeenCalledWith(403);
    expect(mockDelete).not.toHaveBeenCalled();

    const res2 = makeRes();
    await handler(adminReq("DELETE", { query: { id: "3" } }), res2);
    expect(res2.status).toHaveBeenCalledWith(200);
    expect(mockDeleteEq).toHaveBeenCalledWith("id", 3);
  });

  it("DELETE: id 가 없거나 정수가 아니면 400", async () => {
    for (const query of [{}, { id: "x" }, { id: "-1" }]) {
      const res = makeRes();
      await handler(adminReq("DELETE", { query }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
