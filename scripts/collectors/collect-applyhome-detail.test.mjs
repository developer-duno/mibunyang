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
  it("규제 필드 없는 행 → 7종 전부 null (기존 픽스처 회귀 가드)", () => {
    expect(out.adjustment_target_area).toBeNull();
    expect(out.price_cap_applied).toBeNull();
    expect(out.speculation_overheated).toBeNull();
    expect(out.redevelopment_biz).toBeNull();
    expect(out.public_housing_district).toBeNull();
    expect(out.large_scale_district).toBeNull();
    expect(out.metro_private_public_housing).toBeNull();
  });
});

describe("buildScheduleRow — 규제 지정 7종 Y/N → boolean", () => {
  // raw API 전량 2,837건 실측: 7필드 전부 "Y"/"N" 두 값뿐 (다른 코드값·null 없음)
  const REG = {
    MDAT_TRGET_AREA_SECD: "adjustment_target_area",
    PARCPRC_ULS_AT: "price_cap_applied",
    SPECLT_RDN_EARTH_AT: "speculation_overheated",
    IMPRMN_BSNS_AT: "redevelopment_biz",
    PUBLIC_HOUSE_EARTH_AT: "public_housing_district",
    LRSCL_BLDLND_AT: "large_scale_district",
    NPLN_PRVOPR_PUBLIC_HOUSE_AT: "metro_private_public_housing",
  };
  /** @param {unknown} v */
  const rowWithAll = (v) =>
    /** @type {any} */ (Object.fromEntries(Object.keys(REG).map((k) => [k, v])));

  it('"Y" → true (7종 전부)', () => {
    const o = /** @type {any} */ (buildScheduleRow(rowWithAll("Y"), "ap-1"));
    for (const col of Object.values(REG)) expect(o[col]).toBe(true);
  });
  it('"N" → false (7종 전부)', () => {
    const o = /** @type {any} */ (buildScheduleRow(rowWithAll("N"), "ap-1"));
    for (const col of Object.values(REG)) expect(o[col]).toBe(false);
  });
  it("필드 부재(undefined) → null (7종 전부)", () => {
    const o = /** @type {any} */ (buildScheduleRow({ HOUSE_MANAGE_NO: "x" }, "ap-1"));
    for (const col of Object.values(REG)) expect(o[col]).toBeNull();
  });
  it("이상값(빈문자·X·숫자·null) → null (Y/N 외 저장 금지)", () => {
    for (const bad of ["", "X", "y", 1, 0, null]) {
      const o = /** @type {any} */ (buildScheduleRow(rowWithAll(bad), "ap-1"));
      for (const col of Object.values(REG)) expect(o[col]).toBeNull();
    }
  });
  it("String() 변환 시 우연히 'Y'/'N' 이 되는 비문자열 → null (typeof 가드 회귀 방지)", () => {
    // String(["Y"]) === "Y" / String(["N"]) === "N" / String({toString:()=>"Y"}) === "Y".
    // toYn 의 typeof v !== "string" 가드가 완화되면(String(v) 로 바꾸면) 이 케이스만 red 가 된다.
    for (const bad of [["Y"], ["N"], { toString: () => "Y" }]) {
      const o = /** @type {any} */ (buildScheduleRow(rowWithAll(bad), "ap-1"));
      for (const col of Object.values(REG)) expect(o[col]).toBeNull();
    }
  });
  it('공백 포함 " Y " → true (trim)', () => {
    const o = /** @type {any} */ (buildScheduleRow(rowWithAll(" Y "), "ap-1"));
    for (const col of Object.values(REG)) expect(o[col]).toBe(true);
  });
  it("필드별 독립 매핑 — 한 필드만 Y 면 그 컬럼만 true", () => {
    const o = /** @type {any} */ (
      buildScheduleRow(
        /** @type {any} */ ({ HOUSE_MANAGE_NO: "x", PARCPRC_ULS_AT: "Y", IMPRMN_BSNS_AT: "N" }),
        "ap-1",
      )
    );
    expect(o.price_cap_applied).toBe(true);
    expect(o.redevelopment_biz).toBe(false);
    expect(o.adjustment_target_area).toBeNull();
    expect(o.speculation_overheated).toBeNull();
    expect(o.metro_private_public_housing).toBeNull();
  });
  it("API 필드 ↔ 컬럼 1:1 대응 — 어느 두 줄을 맞바꿔도 잡힌다", () => {
    // 벌크 케이스("전부 Y"/"전부 N")는 매핑 두 줄의 우변을 맞바꿔도 통과한다(세션 495b 적대검증
    // 확인 — public_housing_district ↔ large_scale_district 실제 재현). 여기서는 7필드 중
    // 정확히 1개만 "Y", 나머지 6개는 "N" 으로 넣어 그 필드에 대응하는 컬럼 하나만 true 이고
    // 나머지 6개는 전부 false 인지 검증한다 — 두 줄이 맞바뀌면 반드시 다른 컬럼에서 어긋난다.
    for (const apiField of Object.keys(REG)) {
      const row = /** @type {any} */ (
        Object.fromEntries(Object.keys(REG).map((k) => [k, k === apiField ? "Y" : "N"]))
      );
      const o = /** @type {any} */ (buildScheduleRow(row, "ap-1"));
      for (const [otherApi, otherCol] of Object.entries(REG)) {
        expect(o[otherCol], `${apiField}=Y 일 때 ${otherCol}`).toBe(otherApi === apiField);
      }
    }
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
