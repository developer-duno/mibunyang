// @vitest-environment node
// /api/upcoming 단위 + 핸들러 통합 테스트
import { describe, it, expect, vi, beforeEach } from "vitest";

// Supabase chainable mock — .from().select().in() 체인이 select 인자를 캡처
let lastSelectArg: any = null;
const mockIn = vi.fn();
const mockSelect = vi.fn((arg: any) => {
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
    (checkRateLimit as any).mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const req = { method: "GET", headers: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "300");
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

const {
  default: handlerImport,
  extractDates,
  inferEventFromName,
  findStalePlanIds,
  recruitDateIsPast,
  todayIso,
} = await import("./upcoming.js");
const { checkRateLimit } = await import("./_lib/rateLimit.js");
const handler = handlerImport as any;

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() } as any;
}

describe("extractDates — 캘린더 날짜 추출 (spec § 3-1-A·B)", () => {
  it("청약중 단지의 presaleRecruitDate (YYYY-MM-DD) → apply_start 매핑", () => {
    const apt = { presaleStage: "청약중", presaleRecruitDate: "2026-05-08", presaleSchedule: null };
    const result = extractDates(apt);
    expect(result).toEqual([{ date: "2026-05-08", event: "apply_start" }]);
  });

  it("분양계획 단지의 presaleRecruitDate → presale_announce 매핑 (spec § 6-1 4색)", () => {
    const apt = { presaleStage: "분양계획", presaleRecruitDate: "2026-06-15", presaleSchedule: null };
    const result = extractDates(apt);
    expect(result).toEqual([{ date: "2026-06-15", event: "presale_announce" }]);
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

  it("청약중 단지의 presaleRecruitDate + presaleSchedule 둘 다 → 2건 반환", () => {
    const apt = {
      presaleStage: "청약중",
      presaleRecruitDate: "2026-05-08",
      presaleSchedule: { scheduleName: "당첨자 발표", dateInfo: "2026.05.20", schdl_info: null },
    };
    const result = extractDates(apt);
    expect(result).toHaveLength(2);
    expect(result[0].event).toBe("apply_start");
    expect(result[1].event).toBe("winner_announce");
  });

  it("분양계획 단지 + scheduleName='모집공고' → presale_announce", () => {
    const apt = {
      presaleStage: "분양계획",
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "모집공고일", dateInfo: "2026.06.10", schdl_info: null },
    };
    expect(extractDates(apt)[0].event).toBe("presale_announce");
  });

  // 세션 469: 실데이터는 하이픈(YYYY-MM-DD) — 점만 허용하던 버그로 schedule 이벤트가 전량 탈락하던 사각
  it("presaleSchedule.dateInfo 하이픈 형식(YYYY-MM-DD) → 정상 매핑 (실데이터 형식)", () => {
    const apt = {
      presaleStage: "청약중",
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "1순위 청약", dateInfo: "2026-05-10", schdl_info: null },
    };
    expect(extractDates(apt)).toEqual([{ date: "2026-05-10", event: "apply_start" }]);
  });

  // 세션 469: 월-only(YYYY-MM, 일자 미상) → 1일 강제 아님을 monthOnly 플래그로 명시
  it("presaleRecruitDate 월-only(YYYY-MM) → date=YYYY-MM-01 + monthOnly:true", () => {
    const apt = { presaleStage: "분양계획", presaleRecruitDate: "2026-04", presaleSchedule: null };
    expect(extractDates(apt)).toEqual([{ date: "2026-04-01", event: "presale_announce", monthOnly: true }]);
  });

  it("dateInfo 월-only(YYYY.MM 점 형식도) → monthOnly:true", () => {
    const apt = {
      presaleStage: "분양계획",
      presaleRecruitDate: null,
      presaleSchedule: { scheduleName: "모집공고", dateInfo: "2026.05", schdl_info: null },
    };
    expect(extractDates(apt)).toEqual([{ date: "2026-05-01", event: "presale_announce", monthOnly: true }]);
  });

  it("일자 있는 날짜는 monthOnly 플래그 없음", () => {
    const apt = { presaleStage: "청약중", presaleRecruitDate: "2026-05-08", presaleSchedule: null };
    const result = extractDates(apt);
    expect(result[0].monthOnly).toBeUndefined();
  });
});

describe("findStalePlanIds — 접수시작일 지난 곧분양 제외 (세션 469)", () => {
  // presale_schedule_official 를 모킹하는 최소 sb 스텁
  const makeSb = (scheduleRows: any[]) => ({
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: scheduleRows, error: null }),
      }),
    }),
  });

  it("접수시작일(general_rank1_bgnde)이 오늘보다 과거 → stale 로 제외", async () => {
    const rows = [{ id: "ap-1", presaleStage: "분양계획" }];
    const sb = makeSb([{ apartment_id: "ap-1", general_rank1_bgnde: "2026-05-01", recruit_date: "2026-04-01" }]);
    const stale = await findStalePlanIds(sb, rows, "2026-07-03");
    expect(stale.has("ap-1")).toBe(true);
  });

  it("접수시작일이 오늘 이후(미래) → 제외 안 함", async () => {
    const rows = [{ id: "ap-2", presaleStage: "분양계획" }];
    const sb = makeSb([{ apartment_id: "ap-2", general_rank1_bgnde: "2026-08-01", recruit_date: "2026-07-01" }]);
    const stale = await findStalePlanIds(sb, rows, "2026-07-03");
    expect(stale.has("ap-2")).toBe(false);
  });

  it("공식 접수일 없음(데이터 미보유) → 제외 안 함 (네이버 stage 신뢰)", async () => {
    const rows = [{ id: "ap-3", presaleStage: "분양계획" }];
    const sb = makeSb([]);
    const stale = await findStalePlanIds(sb, rows, "2026-07-03");
    expect(stale.has("ap-3")).toBe(false);
  });

  it("special_receipt_bgnde 만 있어도(1순위 null) 판정", async () => {
    const rows = [{ id: "ap-4", presaleStage: "분양계획" }];
    const sb = makeSb([
      {
        apartment_id: "ap-4",
        general_rank1_bgnde: null,
        special_receipt_bgnde: "2026-06-01",
        recruit_date: "2026-05-01",
      },
    ]);
    const stale = await findStalePlanIds(sb, rows, "2026-07-03");
    expect(stale.has("ap-4")).toBe(true);
  });

  it("여러 차수 중 최신(recruit_date desc) 접수일로 판정", async () => {
    const rows = [{ id: "ap-5", presaleStage: "분양계획" }];
    const sb = makeSb([
      { apartment_id: "ap-5", general_rank1_bgnde: "2026-05-01", recruit_date: "2026-04-01" },
      { apartment_id: "ap-5", general_rank1_bgnde: "2026-08-01", recruit_date: "2026-07-01" }, // 최신 = 미래
    ]);
    const stale = await findStalePlanIds(sb, rows, "2026-07-03");
    expect(stale.has("ap-5")).toBe(false); // 최신 차수가 미래라 유지
  });

  it("분양계획 단지 없으면 빈 Set (쿼리 스킵)", async () => {
    const rows = [{ id: "ap-6", presaleStage: "분양중" }];
    const sb = makeSb([]);
    const stale = await findStalePlanIds(sb, rows, "2026-07-03");
    expect(stale.size).toBe(0);
  });

  it("조회 에러 시 fail-open — 단 자체 모집일 과거(B)는 유지 (세션 470)", async () => {
    // 공식 조회가 실패해도 (B) 자체 모집일 과거 판정 결과는 남는다.
    const rows = [
      { id: "ap-7", presaleStage: "분양계획", presaleRecruitDate: null }, // 날짜 미상 → 유지
      { id: "ap-8", presaleStage: "분양계획", presaleRecruitDate: "2026-04" }, // 과거 월 → 제외
    ];
    const sb = {
      from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }),
    };
    const stale = await findStalePlanIds(sb, rows, "2026-07-03");
    expect(stale.has("ap-7")).toBe(false);
    expect(stale.has("ap-8")).toBe(true);
  });

  // 세션 470: 공식 스케줄이 없는 네이버-only 과거 공고를 자체 모집일로 제외 (fail-open 사각 보완)
  it("공식 스케줄 없어도 자체 모집일이 과거 월 → 제외 (B 규칙)", async () => {
    const rows = [{ id: "ap-b1", presaleStage: "분양계획", presaleRecruitDate: "2026-04" }];
    const sb = makeSb([]); // 공식 스케줄 0건
    const stale = await findStalePlanIds(sb, rows, "2026-07-04");
    expect(stale.has("ap-b1")).toBe(true);
  });

  it("자체 모집일이 미래 월 → 유지 (진짜 곧분양 보호)", async () => {
    const rows = [{ id: "ap-b2", presaleStage: "분양계획", presaleRecruitDate: "2026-11" }];
    const sb = makeSb([]);
    const stale = await findStalePlanIds(sb, rows, "2026-07-04");
    expect(stale.has("ap-b2")).toBe(false);
  });

  it("자체 모집일이 이번 달(경계) → 유지 (당월은 아직 안 지남)", async () => {
    const rows = [{ id: "ap-b3", presaleStage: "분양계획", presaleRecruitDate: "2026-07" }];
    const sb = makeSb([]);
    const stale = await findStalePlanIds(sb, rows, "2026-07-04");
    expect(stale.has("ap-b3")).toBe(false);
  });

  it("자체 모집일 '미정'(파싱 불가) → 유지 (fail-open, 사장님 결정)", async () => {
    const rows = [{ id: "ap-b4", presaleStage: "분양계획", presaleRecruitDate: "미정" }];
    const sb = makeSb([]);
    const stale = await findStalePlanIds(sb, rows, "2026-07-04");
    expect(stale.has("ap-b4")).toBe(false);
  });
});

describe("recruitDateIsPast — 자체 모집일 과거 판정 (세션 470)", () => {
  const today = "2026-07-04";
  it("과거 full-date (YYYY-MM-DD) → true", () => {
    expect(recruitDateIsPast("2026-04-17", today)).toBe(true);
  });
  it("과거 month-only (YYYY-MM) → true", () => {
    expect(recruitDateIsPast("2026-04", today)).toBe(true);
    expect(recruitDateIsPast("2026.04", today)).toBe(true); // 점 형식도
  });
  it("미래 full-date → false", () => {
    expect(recruitDateIsPast("2026-08-20", today)).toBe(false);
  });
  it("미래 month-only → false", () => {
    expect(recruitDateIsPast("2026-11", today)).toBe(false);
  });
  it("이번 달 month-only(경계) → false (당월 유지)", () => {
    expect(recruitDateIsPast("2026-07", today)).toBe(false);
  });
  it("오늘 당일 full-date(경계) → false (당일은 안 지남)", () => {
    expect(recruitDateIsPast("2026-07-04", today)).toBe(false);
  });
  it("파싱 불가('미정')·null·빈문자 → false (fail-open)", () => {
    expect(recruitDateIsPast("미정", today)).toBe(false);
    expect(recruitDateIsPast(null, today)).toBe(false);
    expect(recruitDateIsPast("", today)).toBe(false);
    expect(recruitDateIsPast("하반기", today)).toBe(false);
  });
});

describe("todayIso (세션 469)", () => {
  it("Date → YYYY-MM-DD 로컬", () => {
    expect(todayIso(new Date(2026, 6, 3))).toBe("2026-07-03"); // month 6 = 7월
  });
});

describe("inferEventFromName — 키워드 휴리스틱 (spec § 6-1 4색)", () => {
  it("'당첨' 포함 → winner_announce", () => {
    expect(inferEventFromName("당첨자 발표")).toBe("winner_announce");
  });

  it("'마감' 포함 → apply_end", () => {
    expect(inferEventFromName("청약 마감")).toBe("apply_end");
  });

  it("'종료' 포함 → apply_end", () => {
    expect(inferEventFromName("청약 종료")).toBe("apply_end");
  });

  it("'모집' 포함 → presale_announce", () => {
    expect(inferEventFromName("입주자 모집공고")).toBe("presale_announce");
  });

  it("'분양공고' 포함 → presale_announce", () => {
    expect(inferEventFromName("분양공고 게시")).toBe("presale_announce");
  });

  it("'청약' 포함 (마감/모집 키워드 없음) → apply_start", () => {
    expect(inferEventFromName("1순위 청약일")).toBe("apply_start");
  });

  it("키워드 없음 + isPlanStage=true → presale_announce", () => {
    expect(inferEventFromName("기타 일정", true)).toBe("presale_announce");
  });

  it("키워드 없음 + isPlanStage=false → etc", () => {
    expect(inferEventFromName("기타 일정", false)).toBe("etc");
  });

  it("null/undefined + isPlanStage=true → presale_announce", () => {
    expect(inferEventFromName(null, true)).toBe("presale_announce");
    expect(inferEventFromName(undefined, true)).toBe("presale_announce");
  });

  it("null + isPlanStage=false → etc", () => {
    expect(inferEventFromName(null)).toBe("etc");
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
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  });

  it("presaleStage 별 stages 분류 + calendar 매핑", async () => {
    // 분양계획 단지는 먼 미래 모집일(2099-05-08) — 세션 470 자체 모집일 과거 제외 규칙에 안 걸리게(당월 지나도 안전)
    mockIn.mockResolvedValueOnce({
      data: [
        { id: "ap-1", presaleStage: "분양계획", presaleRecruitDate: "2099-05-08", presaleSchedule: null },
        {
          id: "ap-2",
          presaleStage: "청약중",
          presaleRecruitDate: null,
          presaleSchedule: { scheduleName: "당첨자 발표", dateInfo: "2026.05.20" },
        },
        { id: "ap-3", presaleStage: "분양중", presaleRecruitDate: null, presaleSchedule: null },
      ],
      error: null,
    });
    const req = { method: "GET", headers: {} };
    const res = makeRes();
    await handler(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.totals).toEqual({ plan: 1, apply: 1, sale: 1 });
    // 분양계획 단지는 presale_announce (4번째 색 — spec § 6-1)
    expect(body.calendar["2099-05-08"]).toEqual([{ id: "ap-1", event: "presale_announce" }]);
    expect(body.calendar["2026-05-20"]).toEqual([{ id: "ap-2", event: "winner_announce" }]);
  });
});
