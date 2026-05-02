// @vitest-environment node
// /api/upcoming 단위 + 핸들러 통합 테스트
import { describe, it, expect, vi, beforeEach } from "vitest";

// Supabase chainable mock — .from().select().in() 체인이 select 인자를 캡처
let lastSelectArg = null;
const mockIn = vi.fn();
const mockSelect = vi.fn((arg) => {
  lastSelectArg = arg;
  return { in: mockIn };
});

vi.mock("./_lib/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: vi.fn(() => ({ select: mockSelect })) })),
}));

vi.mock("./_lib/cors.js", () => ({
  handleCors: vi.fn().mockReturnValue(false),
}));

vi.mock("./_lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  lastSelectArg = null;
  mockIn.mockResolvedValue({ data: [], error: null });
});

describe("upcoming rateLimit", () => {
  it("proxy rateLimit를 적용한다", async () => {
    mockIn.mockResolvedValueOnce({ data: [], error: null });
    const req = { method: "GET", headers: {} };
    const res = makeRes();
    await handler(req, res);
    expect(checkRateLimit).toHaveBeenCalledWith(req, "proxy");
  });

  it("rateLimit 초과 시 429 + Retry-After, Supabase 미조회", async () => {
    checkRateLimit.mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const req = { method: "GET", headers: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "300");
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

const { default: handler, extractDates } = await import("./upcoming.js");
const { checkRateLimit } = await import("./_lib/rateLimit.js");

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() };
}

describe("extractDates — 캘린더 날짜 추출 (spec § 3-1-A·B)", () => {
  it("presaleRecruitDate (YYYY-MM-DD) → apply_start 매핑", () => {
    const apt = { presaleRecruitDate: "2026-05-08", presaleSchedule: null };
    const result = extractDates(apt);
    expect(result).toEqual([{ date: "2026-05-08", event: "apply_start" }]);
  });

  it("presaleSchedule.dateInfo (YYYY.MM.DD) + scheduleName 청약 → apply_start", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "1순위 청약일", dateInfo: "2026.05.10", schdl_info: null },
    };
    const result = extractDates(apt);
    expect(result).toEqual([{ date: "2026-05-10", event: "apply_start" }]);
  });

  it("scheduleName 당첨자 발표 → winner_announce", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "당첨자 발표", dateInfo: "2026.05.20", schdl_info: null },
    };
    expect(extractDates(apt)[0].event).toBe("winner_announce");
  });

  it("scheduleName 마감 → apply_end", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "청약 마감", dateInfo: "2026.05.12", schdl_info: null },
    };
    expect(extractDates(apt)[0].event).toBe("apply_end");
  });

  it("dateInfo 정규식 미일치 → skip (캘린더 매핑 X)", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "청약일", dateInfo: "5월 8일", schdl_info: null },
    };
    expect(extractDates(apt)).toEqual([]);
  });

  it("presaleSchedule 문자열 형태 (B형태) → skip (캘린더 매핑 X, spec § 3-1-A 정책)", () => {
    const apt = {
      presaleRecruitDate: null,
      presaleSchedule: "5월 청약 예정",
    };
    expect(extractDates(apt)).toEqual([]);
  });

  it("presaleSchedule null (C형태) + presaleRecruitDate null → 빈 배열", () => {
    const apt = { presaleRecruitDate: null, presaleSchedule: null };
    expect(extractDates(apt)).toEqual([]);
  });

  it("presaleRecruitDate 비정형 텍스트 (예: '미정') → skip", () => {
    const apt = { presaleRecruitDate: "미정", presaleSchedule: null };
    expect(extractDates(apt)).toEqual([]);
  });

  it("presaleRecruitDate + presaleSchedule 둘 다 → 2건 반환", () => {
    const apt = {
      presaleRecruitDate: "2026-05-08",
      presaleSchedule: { scheduleName: "당첨자 발표", dateInfo: "2026.05.20", schdl_info: null },
    };
    const result = extractDates(apt);
    expect(result).toHaveLength(2);
    expect(result[0].event).toBe("apply_start");
    expect(result[1].event).toBe("winner_announce");
  });
});

describe("handleGet — Supabase select 컬럼명 + 핸들러 분기 (회귀 방지)", () => {
  it("select 문에 catsCache 카멜케이스 포함, cats_cache snake_case 미포함", async () => {
    const req = { method: "GET", headers: {} };
    const res = makeRes();
    await handler(req, res);
    // 회귀 방지 핵심: VIEW 별칭이 "catsCache" 이므로 카멜케이스만 허용
    expect(lastSelectArg).toContain("catsCache");
    expect(lastSelectArg).not.toContain("cats_cache");
  });

  it("Supabase 빈 데이터 → 200 + 빈 stages/calendar/totals", async () => {
    mockIn.mockResolvedValueOnce({ data: [], error: null });
    const req = { method: "GET", headers: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.stages).toEqual({ plan: [], apply: [], sale: [] });
    expect(body.calendar).toEqual({});
    expect(body.totals).toEqual({ plan: 0, apply: 0, sale: 0 });
  });

  it("Supabase error → 500 + ok:false", async () => {
    mockIn.mockResolvedValueOnce({ data: null, error: { message: "column does not exist" } });
    const req = { method: "GET", headers: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({ ok: false });
  });

  it("Cache-Control 헤더 s-maxage=300, stale-while-revalidate=600 설정", async () => {
    mockIn.mockResolvedValueOnce({ data: [], error: null });
    const req = { method: "GET", headers: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "s-maxage=300, stale-while-revalidate=600",
    );
  });

  it("presaleStage 별 stages 분류 + calendar 매핑", async () => {
    mockIn.mockResolvedValueOnce({
      data: [
        { id: "ap-1", presaleStage: "분양계획", presaleRecruitDate: "2026-05-08", presaleSchedule: null },
        { id: "ap-2", presaleStage: "청약중", presaleRecruitDate: null, presaleSchedule: { scheduleName: "당첨자 발표", dateInfo: "2026.05.20" } },
        { id: "ap-3", presaleStage: "분양중", presaleRecruitDate: null, presaleSchedule: null },
      ],
      error: null,
    });
    const req = { method: "GET", headers: {} };
    const res = makeRes();
    await handler(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.totals).toEqual({ plan: 1, apply: 1, sale: 1 });
    expect(body.calendar["2026-05-08"]).toEqual([{ id: "ap-1", event: "apply_start" }]);
    expect(body.calendar["2026-05-20"]).toEqual([{ id: "ap-2", event: "winner_announce" }]);
  });
});
