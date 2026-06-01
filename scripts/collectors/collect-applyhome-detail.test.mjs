// @ts-check
import { describe, it, expect, vi } from "vitest";

// collect-applyhome-detail.mjs 순수 함수 테스트
// 검증: 매칭 안전 게이트(sim>=0.85 AND region) + 날짜 ISO 파싱 + 평형 변환 + graceful

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    selectAll: vi.fn(),
    upsertBatch: vi.fn(async (_t, rows) => rows.length),
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
  };
});

const {
  normName, addrToRegion, matchDetailToApt, buildScheduleRow, buildUnitRow,
} = await import("./collect-applyhome-detail.mjs");

const APTS = [
  { id: "ap-1", name: "검암역자이르네", region: "인천" },
  { id: "ap-2", name: "써밋 더힐", region: "부산" },
  { id: "ap-3", name: "힐스테이트 구월아트파크", region: "인천" },
];

describe("normName — 이름 정규화", () => {
  it("괄호·공백 제거", () => {
    expect(normName("오정 해모로 스마트시티(조합원 취소분)")).toBe("오정해모로스마트시티");
    expect(normName("써밋 더힐")).toBe("써밋더힐");
  });
  it("null/빈값 → 빈 문자열", () => {
    expect(normName(null)).toBe("");
    expect(normName(undefined)).toBe("");
  });
});

describe("addrToRegion — 주소 → region 약칭", () => {
  it("시도 첫 토큰 정규화", () => {
    expect(addrToRegion("인천광역시 서구 검암동")).toBe("인천");
    expect(addrToRegion("부산광역시 동래구")).toBe("부산");
    expect(addrToRegion("경기도 성남시 성남낙생지구")).toBe("경기");
  });
  it("시도명에 다른 시도 약칭이 부분문자열로 들어가도 정확 (세션 360 버그 가드)", () => {
    // 이전 버그: addr 전체에서 약칭 "광주" 매칭 → "경기도 광주시"가 광주광역시로 오파싱
    expect(addrToRegion("경기도 광주시 탄벌동")).toBe("경기");
    expect(addrToRegion("광주광역시 북구")).toBe("광주");
    expect(addrToRegion("경기 광주시")).toBe("경기"); // 약칭 head + 부분문자열 함정
  });
  it("특별자치시/도 + 약칭 head 정규화", () => {
    expect(addrToRegion("세종특별자치시")).toBe("세종");
    expect(addrToRegion("강원특별자치도 춘천시")).toBe("강원");
    expect(addrToRegion("전북특별자치도 전주시")).toBe("전북");
    expect(addrToRegion("광주 북구")).toBe("광주");
  });
  it("null → null", () => {
    expect(addrToRegion(null)).toBeNull();
    expect(addrToRegion("")).toBeNull();
  });
});

describe("matchDetailToApt — 안전 게이트 매칭", () => {
  it("동일 이름 + region 일치 → 매칭 (sim=1.0)", () => {
    const m = matchDetailToApt({ HOUSE_NM: "검암역자이르네", HSSPLY_ADRES: "인천광역시 서구 검암동" }, APTS);
    expect(m?.apt.id).toBe("ap-1");
    expect(m?.sim).toBeCloseTo(1.0, 2);
  });
  it("이름 같아도 region 불일치 → null (동명이지역 오매칭 차단)", () => {
    // 써밋 더힐은 부산인데, 청약홈 주소가 서울이면 매칭 거부
    const m = matchDetailToApt({ HOUSE_NM: "써밋 더힐", HSSPLY_ADRES: "서울특별시 강남구" }, APTS);
    expect(m).toBeNull();
  });
  it("sim < 0.85 → null (느슨한 매칭 차단)", () => {
    const m = matchDetailToApt({ HOUSE_NM: "전혀 다른 단지", HSSPLY_ADRES: "인천광역시 서구" }, APTS);
    expect(m).toBeNull();
  });
  it("HOUSE_NM 없으면 → null", () => {
    expect(matchDetailToApt({ HSSPLY_ADRES: "인천" }, APTS)).toBeNull();
  });
  it("주소 없으면 region 게이트 건너뜀 (이름만으로 매칭)", () => {
    const m = matchDetailToApt({ HOUSE_NM: "써밋 더힐" }, APTS);
    expect(m?.apt.id).toBe("ap-2");
  });
});

describe("buildScheduleRow — Detail → 일정 행", () => {
  const row = {
    HOUSE_MANAGE_NO: "2026820004", PBLANC_NO: "2026820004",
    RCRIT_PBLANC_DE: "2026-05-29", SPSPLY_RCEPT_BGNDE: "2026-06-08", SPSPLY_RCEPT_ENDDE: null,
    GNRL_RNK1_CRSPAREA_RCPTDE: "2026-07-13", PRZWNER_PRESNATN_DE: "2026-07-31",
    CNTRCT_CNCLS_BGNDE: "2026-11-07", MVN_PREARNGE_YM: "202902",
    TOT_SUPLY_HSHLDCO: 933, BSNS_MBY_NM: "한국토지주택공사", CNSTRCT_ENTRPS_NM: "디엘이앤씨",
    PBLANC_URL: "https://applyhome.co.kr/x",
  };
  const out = buildScheduleRow(row, "ap-1");
  it("ISO 날짜 그대로 DATE 매핑", () => {
    expect(out.recruit_date).toBe("2026-05-29");
    expect(out.general_rank1_bgnde).toBe("2026-07-13");
    expect(out.winner_announce_date).toBe("2026-07-31");
  });
  it("null 날짜 → null 보존", () => {
    expect(out.special_receipt_endde).toBeNull();
  });
  it("MVN_PREARNGE_YM은 YYYYMM TEXT 보존", () => {
    expect(out.move_in_ym).toBe("202902");
  });
  it("공급세대수 INTEGER + 시행/시공 trim", () => {
    expect(out.tot_supply).toBe(933);
    expect(out.biz_entity).toBe("한국토지주택공사");
  });
  it("apartment_id + house_manage_no 복합키 채움", () => {
    expect(out.apartment_id).toBe("ap-1");
    expect(out.house_manage_no).toBe("2026820004");
  });
});

describe("buildUnitRow — Mdl → 평형 행", () => {
  const row = {
    HOUSE_MANAGE_NO: "2026820004", MODEL_NO: "01", HOUSE_TY: "051.0000A",
    SUPLY_AR: "73.5335", SUPLY_HSHLDCO: 0, SPSPLY_HSHLDCO: 115,
    NWBB_HSHLDCO: 50, LFE_FRST_HSHLDCO: 30, MNYCH_HSHLDCO: 0, LTTOT_TOP_AMOUNT: "59076",
  };
  const out = buildUnitRow(row, "ap-1");
  it("면적 REAL + 세대수 INTEGER", () => {
    expect(out.supply_area).toBeCloseTo(73.5335, 3);
    expect(out.general_supply).toBe(0);
    expect(out.special_supply).toBe(115);
    expect(out.top_amount).toBe(59076);
  });
  it("특공유형 JSONB — 0 초과만 포함", () => {
    expect(out.special_by_type).toEqual({ sinhon: 50, saengae_choecho: 30 });
  });
  it("특공 전부 0이면 special_by_type null", () => {
    const o2 = buildUnitRow({ HOUSE_MANAGE_NO: "x", MODEL_NO: "01", SUPLY_HSHLDCO: 10 }, "ap-1");
    expect(o2.special_by_type).toBeNull();
  });
  it("복합키 3컬럼 채움", () => {
    expect(out.model_no).toBe("01");
    expect(out.house_manage_no).toBe("2026820004");
  });
});

describe("graceful shutdown — SIGTERM", () => {
  it("setupGracefulShutdown emit 후 interrupted true", async () => {
    const { setupGracefulShutdown } = await import("./_shared.mjs");
    const isInterrupted = setupGracefulShutdown("test-applyhome-detail");
    process.emit("SIGTERM");
    expect(isInterrupted()).toBe(true);
  });
});
