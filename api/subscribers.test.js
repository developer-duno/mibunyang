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
const { checkRateLimit } = await import("./_lib/rateLimit.js");

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
  mockUpsert.mockResolvedValue({ error: null });
  checkRateLimit.mockResolvedValue({ limited: false });
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

describe("subscribers POST signup", () => {
  it("subscribes with normalized phone and restores opt-in state", async () => {
    const res = makeRes();

    await handler({
      method: "POST",
      headers: {},
      body: {
        phone: "010-1234-5678",
        region: " 서울특별시 ",
        gu: " 강동구 ",
        apartment_id: "apt-123",
        consent: true,
      },
    }, res);

    expect(mockFrom).toHaveBeenCalledWith("subscribers");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+821012345678",
        region: "서울특별시",
        gu: "강동구",
        apartment_id: "apt-123",
        consent_source: "upcoming-page",
        opt_out_at: null,
      }),
      { onConflict: "phone,region_key,gu_key,apartment_key" }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it("rejects signup without consent", async () => {
    const res = makeRes();

    await handler({
      method: "POST",
      headers: {},
      body: { phone: "010-1234-5678", consent: false },
    }, res);

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("stores empty scope as null for nationwide subscription", async () => {
    const res = makeRes();

    await handler({
      method: "POST",
      headers: {},
      body: { phone: "01012345678", consent: true },
    }, res);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+821012345678",
        region: null,
        gu: null,
        apartment_id: null,
      }),
      { onConflict: "phone,region_key,gu_key,apartment_key" }
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 429 when subscriber rate limit is exceeded", async () => {
    checkRateLimit.mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();

    await handler({
      method: "POST",
      headers: {},
      body: { phone: "010-1234-5678", consent: true },
    }, res);

    expect(checkRateLimit).toHaveBeenCalledWith(expect.objectContaining({ method: "POST" }), "subscribers");
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "300");
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

describe("normalizeToE164", () => {
  it("normalizes 010-1234-5678", () => {
    expect(normalizeToE164("010-1234-5678")).toBe("+821012345678");
  });

  it("normalizes 01012345678", () => {
    expect(normalizeToE164("01012345678")).toBe("+821012345678");
  });

  it("normalizes 010 1234 5678", () => {
    expect(normalizeToE164("010 1234 5678")).toBe("+821012345678");
  });

  it("normalizes legacy 011 numbers", () => {
    expect(normalizeToE164("011-123-4567")).toBe("+82111234567");
  });

  it("normalizes legacy 019 numbers", () => {
    expect(normalizeToE164("019-1234-5678")).toBe("+821912345678");
  });

  it("rejects landline numbers", () => {
    expect(normalizeToE164("02-123-4567")).toBeNull();
  });

  it("rejects empty strings", () => {
    expect(normalizeToE164("")).toBeNull();
  });

  it("rejects null", () => {
    expect(normalizeToE164(null)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(normalizeToE164(1012345678)).toBeNull();
  });

  it("rejects foreign numbers", () => {
    expect(normalizeToE164("+1-234-567-8900")).toBeNull();
  });

  it("rejects too-short numbers", () => {
    expect(normalizeToE164("010-12-34")).toBeNull();
  });
});
