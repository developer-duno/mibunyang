// /api/subscribers 단위 테스트
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const mockEq = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn((table) => {
  if (table === "subscribers") {
    return { update: mockUpdate, upsert: mockUpsert };
  }
  return {};
});

vi.mock("./_lib/supabase.js", () => ({
  getMibuyangSupabase: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("./_lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

const { default: handler, normalizeToE164 } = await import("./subscribers.js");

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() };
}

function makeOptOutToken(phone, secret) {
  return crypto.createHmac("sha256", secret).update(normalizeToE164(phone)).digest("hex");
}

beforeEach(() => {
  process.env.SUBSCRIBERS_OPT_OUT_SECRET = "test-opt-out-secret";
  vi.clearAllMocks();
  mockEq.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUBSCRIBERS_OPT_OUT_SECRET;
});

describe("subscribers DELETE opt-out", () => {
  it("returns 500 when opt-out secret is missing", async () => {
    delete process.env.SUBSCRIBERS_OPT_OUT_SECRET;
    const res = makeRes();
    await handler({
      method: "DELETE",
      headers: {},
      body: { phone: "010-1234-5678", token: "abc123" },
    }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 401 before timingSafeEqual for malformed token length", async () => {
    const timingSafeEqual = vi.spyOn(crypto, "timingSafeEqual");
    const res = makeRes();
    await handler({
      method: "DELETE",
      headers: {},
      body: { phone: "010-1234-5678", token: "not-hex" },
    }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  it("opts out with a valid token", async () => {
    const phone = "010-1234-5678";
    const token = makeOptOutToken(phone, process.env.SUBSCRIBERS_OPT_OUT_SECRET);
    const res = makeRes();
    await handler({
      method: "DELETE",
      headers: {},
      body: { phone, token },
    }, res);
    expect(mockFrom).toHaveBeenCalledWith("subscribers");
    expect(mockUpdate).toHaveBeenCalledWith({ opt_out_at: expect.any(String) });
    expect(mockEq).toHaveBeenCalledWith("phone", "+821012345678");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});

describe("normalizeToE164 — 한국 휴대폰 → E.164", () => {
  it("010-1234-5678 → +821012345678", () => {
    expect(normalizeToE164("010-1234-5678")).toBe("+821012345678");
  });

  it("01012345678 (구분자 없음) → +821012345678", () => {
    expect(normalizeToE164("01012345678")).toBe("+821012345678");
  });

  it("010 1234 5678 (공백 구분) → +821012345678", () => {
    expect(normalizeToE164("010 1234 5678")).toBe("+821012345678");
  });

  it("011-123-4567 (구식 PCS) → +821112345678 형태 변환", () => {
    expect(normalizeToE164("011-123-4567")).toBe("+82111234567");
  });

  it("019-1234-5678 (구식) → +8219...", () => {
    expect(normalizeToE164("019-1234-5678")).toBe("+821912345678");
  });

  it("02-123-4567 (서울 유선) → null", () => {
    expect(normalizeToE164("02-123-4567")).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(normalizeToE164("")).toBeNull();
  });

  it("null → null", () => {
    expect(normalizeToE164(null)).toBeNull();
  });

  it("숫자 타입 → null", () => {
    expect(normalizeToE164(1012345678)).toBeNull();
  });

  it("외국 번호 (+1-234-567-8900) → null (한국 외 차단)", () => {
    expect(normalizeToE164("+1-234-567-8900")).toBeNull();
  });

  it("010-12-34 (자릿수 부족) → null", () => {
    expect(normalizeToE164("010-12-34")).toBeNull();
  });
});
