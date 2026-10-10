// @ts-check
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── apartments 명단 페이징 배선 가드 (세션543 W2) ──
/**
 * ⚠️ 주석을 걷어낸 사본에 돌린다 — `guards-must-be-mutation-tested.md`.
 * 줄 주석은 **줄머리만** 지운다(코드 안 URL 이 잘려 검사 범위가 조용히 깎이는 것을 막는다).
 */
const PAGING_SRC = readFileSync(fileURLToPath(new URL("./collect-applyhome-detail.mjs", import.meta.url)), "utf8")
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
  .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");

describe("apartments 명단 페이징 — 고유키 커서 (세션543 W2)", () => {
  it("검사 대상이 주석 제거 후에도 남아 있다 (스트리퍼 자체 점검)", () => {
    expect(PAGING_SRC).toContain("selectAll");
    expect(PAGING_SRC).toContain('.from("apartments")');
  });

  it("★ selectAll 호출이 keyCol \"id\" 를 넘긴다 — 없으면 무정렬 OFFSET 이라 큰 표에서 행이 샌다", () => {
    // `selectAll(fn, sb)` 는 ORDER BY 없는 `.range()` 경로다(`_shared.mjs`).
    // apartments 는 2,600행+ 이라 페이지마다 다른 표본이 와서 **에러 없이** 행을 잃는다
    // (`unordered-pagination-loses-rows.md`).
    expect(PAGING_SRC).toMatch(/select\("id, name, region, presale_type"\),\s*sb,\s*"id",/);
  });

  it("★ select 에 그 키가 실제로 들어 있다 — 없으면 selectAll 이 커서를 못 만들어 throw 한다", () => {
    expect(PAGING_SRC).toContain('select("id, name, region, presale_type")');
  });
});

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
  parseHouseTyArea, pickRepresentativeUnit, buildApplyhomePriceRow, planApplyhomePrices, parseImpactOutArg, mergeUnitRows,
} = await import("./collect-applyhome-detail.mjs");
// 통합 시도 분할 헬퍼 — "헬퍼가 판정을 포기했다" 를 테스트가 직접 증명하는 데 쓴다.
const { resolveRegionName } = await import("./_shared.mjs");

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

  // ── 전남광주통합특별시 (2026-07-01) — 세션545 ──
  //
  // ⚠️ 이 파일의 파서는 스펙이 처음에 놓친 **네 번째** 주소 파서다. 통합 이름은 REGION_MAP 에
  //    없고 아래 긴 키 우선 순회가 `head.startsWith("전남")` 로 잡아버려, 헬퍼가 없으면
  //    **광주 27 시군구가 전부 "전남"** 이 된다 → `matchDetailToApt` 의 region 게이트에서
  //    광주 단지가 통째로 오차단(일정·평형 미적재).
  describe("전남광주통합특별시 — 시군구로 가른다 (세션545)", () => {
    it("통합 + 광주 자치구 → 광주 (긴 키 순회의 '전남' 오라벨을 막는다)", () => {
      expect(addrToRegion("전남광주통합특별시 북구 월출동")).toBe("광주");
      expect(addrToRegion("전남광주통합특별시 광산구 수완동")).toBe("광주");
    });

    it("통합 + 전남 시군 → 전남", () => {
      expect(addrToRegion("전남광주통합특별시 순천시 조례동")).toBe("전남");
      expect(addrToRegion("전남광주통합특별시 무안군 삼향읍")).toBe("전남");
    });

    it("★ 통합 시도인데 둘째 토큰이 시군구가 아니면 null — 'startsWith(\"전남\")' 우연을 판정으로 쓰지 않는다", () => {
      // 헬퍼가 판정을 포기했음을 먼저 못 박는다.
      expect(resolveRegionName("전남광주통합특별시", "첨단3지구")).toBeNull();
      // 옛 순회에 넘기면 `head.startsWith("전남")` 이 참이라 "전남" 이 나오는데, 그건 글자 우연이다.
      // 그 값이 굳으면 matchDetailToApt 의 region 게이트가 광주 단지를 거부한다(2차 리뷰 NEW-1).
      expect(addrToRegion("전남광주통합특별시 첨단3지구 A7블록")).toBeNull();
      expect(addrToRegion("전남광주통합특별시 A8블록")).toBeNull();
    });

    it("통합 시도가 아닌 주소는 옛 순회 그대로 (회귀 0)", () => {
      // 라이브 실측(2026-09-10): 첨단3지구 두 곳의 실제 주소는 "광주연구개발특구…" 로 시작해
      // 이 경로를 타지 않는다 — 위 null 규칙이 기존 판정을 건드리지 않음을 못 박는다.
      expect(addrToRegion("광주연구개발특구 첨단3지구 A7블록(전남광주통합특별시 북구 월출동)")).toBe("광주");
      expect(addrToRegion("전라남도 장성군 진원면")).toBe("전남");
    });

    it("경기 광주시 회귀 가드 — 헬퍼가 먼저 돌아도 경기 그대로", () => {
      expect(addrToRegion("경기도 광주시 양벌동")).toBe("경기");
      expect(addrToRegion("경기도 광주시 탄벌동")).toBe("경기");
    });
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

// ── prices 빈칸 채움 (세션622) ──
// 기대값 출처 = 지시서 승인 항목 표 예시(사장님 결정 2026-10-10) · house_ty 형식은 운영 DB 실측("084.8443 " 뒤 공백, "076.5143").
/** @param {string | null} houseTy @param {number | null} top @param {Record<string, unknown>} [extra] */
const unit = (houseTy, top, extra = {}) => /** @type {any} */ ({
  apartment_id: "ap-1", house_manage_no: "h1", model_no: String(houseTy), house_ty: houseTy,
  supply_area: 110.214, general_supply: 100, special_supply: 134, special_by_type: null, top_amount: top, ...extra,
});

describe("parseHouseTyArea — house_ty 앞 숫자 = 전용면적", () => {
  it("뒤 공백·접미 글자를 떼고 읽는다", () => {
    expect(parseHouseTyArea("084.8443 ")).toBeCloseTo(84.8443, 4);
    expect(parseHouseTyArea("059.9649B")).toBeCloseTo(59.9649, 4);
    expect(parseHouseTyArea("101.2A")).toBeCloseTo(101.2, 4);
    expect(parseHouseTyArea("076.5143")).toBeCloseTo(76.5143, 4);
  });
  it("못 읽는 값은 null", () => {
    expect(parseHouseTyArea(null)).toBeNull();
    expect(parseHouseTyArea("")).toBeNull();
    expect(parseHouseTyArea("A타입")).toBeNull();
  });
});

describe("pickRepresentativeUnit — 84㎡ 에 가장 가까운 평형", () => {
  it("① 84형이 있으면 84형", () => {
    const r = pickRepresentativeUnit([unit("059.9649B", 41700), unit("084.8443 ", 43300), unit("101.2A", 57600)]);
    expect(r?.unit.top_amount).toBe(43300);
    expect(r?.area).toBeCloseTo(84.8443, 4);
  });
  it("② 84 없이 59·101 만 있으면 거리 작은 101(17.2) — 59(24.0) 아님", () => {
    const r = pickRepresentativeUnit([unit("059.9649B", 41700), unit("101.2A", 57600)]);
    expect(r?.unit.top_amount).toBe(57600);
  });
  it("③ 거리가 같으면 top_amount 낮은 쪽 — 입력 순서와 무관", () => {
    const a = unit("080.0000", 50000), b = unit("088.0000", 45000);
    expect(pickRepresentativeUnit([a, b])?.unit.top_amount).toBe(45000);
    expect(pickRepresentativeUnit([b, a])?.unit.top_amount).toBe(45000);
  });
  it("⑤ top_amount null/0 행은 제외 — 84형이어도", () => {
    const r = pickRepresentativeUnit([unit("084.9000", 0), unit("084.8443 ", null), unit("059.9649B", 41700)]);
    expect(r?.unit.top_amount).toBe(41700);
  });
  it("원 공고(apt) 행이 있으면 잔여세대(remndr) 행은 84㎡ 에 더 가까워도 무시 — source 없으면 apt", () => {
    // 세션622 실측 꼴: 레이카운티 잔여세대 66200 vs 원 공고 71100
    const r = pickRepresentativeUnit([
      unit("084.0000", 66200, { source: "remndr" }),
      unit("084.9000", 71100, { source: "apt" }),
    ]);
    expect(r?.unit.top_amount).toBe(71100);
    const r2 = pickRepresentativeUnit([unit("084.9000", 66200, { source: "remndr" }), unit("101.2A", 90000)]);
    expect(r2?.unit.top_amount).toBe(90000); // source 없는 행(이번 회차) = apt
  });
  it("원 공고 행이 없으면 잔여세대 행으로", () => {
    const r = pickRepresentativeUnit([unit("059.9649B", 41700, { source: "remndr" }), unit("084.9000", 66200, { source: "remndr" })]);
    expect(r?.unit.top_amount).toBe(66200);
  });
  it("⑤ 전부 제외면 null", () => {
    expect(pickRepresentativeUnit([unit("084.9000", 0), unit("059.9649B", null)])).toBeNull();
    expect(pickRepresentativeUnit([])).toBeNull();
  });
});

describe("buildApplyhomePriceRow — prices 행 값", () => {
  it("price·area·supply_area·supply_count·house_type·recorded_at·pp", () => {
    const row = buildApplyhomePriceRow("ap-9", [unit("084.6120", 59410)], "2026-10-10");
    expect(row).toEqual({
      apartment_id: "ap-9", area: 84.612, supply_area: 110.214, price: 59410,
      // pp = 전용면적 기준(메인 정정 — 운영 DB seed 행 1,000표본 100% 전용 기준) = 2321, 공급 기준(1782)이 아니다
      pp: 2321, house_type: "applyhome_rep", supply_count: 234, recorded_at: "2026-10-10",
    });
    expect(row?.house_type.startsWith("presale_")).toBe(false); // VIEW 가 presale_% 를 뒤로 미룬다
  });
  it("공급세대 둘 다 null 이면 supply_count null · 공급면적 없어도 pp 는 전용면적으로 계산", () => {
    const row = buildApplyhomePriceRow("ap-9", [unit("084.6120", 59410, { general_supply: null, special_supply: null, supply_area: null })], "2026-10-10");
    expect(row?.supply_count).toBeNull();
    expect(row?.supply_area).toBeNull();
    expect(row?.pp).toBe(2321);
  });
  it("고를 평형이 없으면 null", () => {
    expect(buildApplyhomePriceRow("ap-9", [unit("084.6120", 0)], "2026-10-10")).toBeNull();
  });
});

describe("planApplyhomePrices — 빈칸만 채움", () => {
  const units = [unit("084.6120", 59410)];
  it("⑥ 임대 단지(유형·이름) 건너뜀", () => {
    const unitsByApt = new Map([["a1", units], ["a2", units], ["a3", units]]);
    const aptById = new Map([
      ["a1", { id: "a1", name: "어느 단지", region: "경기", presale_type: "국민임대" }],
      ["a2", { id: "a2", name: "○○ 행복주택", region: "경기", presale_type: "민간분양" }],
      ["a3", { id: "a3", name: "분양 단지", region: "경기", presale_type: "민간분양" }],
    ]);
    const p = planApplyhomePrices(unitsByApt, aptById, new Set(), "2026-10-10");
    expect(p.counts).toEqual({ planned: 1, skippedLease: 2, skippedHasPrice: 0, skippedNoUnit: 0, skippedNoApt: 0 });
    expect(p.rows.map((r) => r.apartment_id)).toEqual(["a3"]);
    expect(p.byPresaleType).toEqual({ 민간분양: 1 });
  });
  it("⑦ 이미 가격 있는 단지 건너뜀 · 평형 없음은 따로 셈", () => {
    const unitsByApt = new Map([["a1", units], ["a2", units], ["a3", [unit("084.6120", null)]]]);
    const aptById = new Map([
      ["a1", { id: "a1", name: "가", region: "경기", presale_type: null }],
      ["a2", { id: "a2", name: "나", region: "경기", presale_type: "민간분양" }],
      ["a3", { id: "a3", name: "다", region: "경기", presale_type: "민간분양" }],
    ]);
    const p = planApplyhomePrices(unitsByApt, aptById, new Set(["a2"]), "2026-10-10");
    expect(p.counts).toEqual({ planned: 1, skippedLease: 0, skippedHasPrice: 1, skippedNoUnit: 1, skippedNoApt: 0 });
    expect(p.rows.map((r) => r.apartment_id)).toEqual(["a1"]);
    expect(p.byPresaleType).toEqual({ "(null)": 1 });
  });
});

describe("planApplyhomePrices — apartments 에 없는 단지", () => {
  it("단지 행이 없으면 쓰지 않고 따로 센다(FK 오류 방지)", () => {
    const p = planApplyhomePrices(new Map([["gone", [unit("084.6120", 59410)]]]), new Map(), new Set(), "2026-10-10");
    expect(p.counts).toEqual({ planned: 0, skippedLease: 0, skippedHasPrice: 0, skippedNoUnit: 0, skippedNoApt: 1 });
    expect(p.rows).toEqual([]);
  });
});

describe("mergeUnitRows — DB 누적 행 + 이번 회차 행", () => {
  it("같은 키(apartment_id·house_manage_no·model_no)면 이번 회차가 이기고, 다른 키·옛 공고 단지는 남는다", () => {
    const db = [
      unit("084.6120", 50000, { apartment_id: "a1", house_manage_no: "h1", model_no: "01" }),
      unit("059.9000", 40000, { apartment_id: "a1", house_manage_no: "h1", model_no: "02" }),
      unit("084.0000", 70000, { apartment_id: "old", house_manage_no: "h0", model_no: "01" }), // 지금 API 에 없는 옛 공고
    ];
    const round = [unit("084.6120", 61000, { apartment_id: "a1", house_manage_no: "h1", model_no: "01" })];
    const m = mergeUnitRows(db, round);
    expect([...m.keys()].sort()).toEqual(["a1", "old"]);
    expect((m.get("a1") ?? []).map((u) => u.top_amount).sort()).toEqual([40000, 61000]);
    expect(buildApplyhomePriceRow("a1", m.get("a1"), "2026-10-10")?.price).toBe(61000);
    expect(m.get("old")?.length).toBe(1);
  });
  it("이번 회차 행(source 없음)은 같은 키 DB 행의 source 를 물려받는다 — upsert 가 source 를 안 바꾸므로", () => {
    const db = [unit("084.0000", 66200, { apartment_id: "a1", house_manage_no: "h9", model_no: "01", source: "remndr" })];
    const round = [unit("084.0000", 66300, { apartment_id: "a1", house_manage_no: "h9", model_no: "01" })];
    const u = (mergeUnitRows(db, round).get("a1") ?? [])[0];
    expect(u.top_amount).toBe(66300);
    expect(u.source).toBe("remndr");
  });
});

describe("parseImpactOutArg — 미리보기 전용", () => {
  it("⑧ --impact-out 이 dry-run 없이 오면 throw", () => {
    expect(() => parseImpactOutArg(["node", "x.mjs", "--impact-out=C:/t.json"])).toThrow(/dry-run/);
  });
  it("= 없이 띄어 쓴 꼴·값 없는 --impact-out 은 조용히 무시하지 않고 throw", () => {
    expect(() => parseImpactOutArg(["node", "x.mjs", "--dry-run", "--impact-out", "C:/t.json"])).toThrow(/=/);
    expect(() => parseImpactOutArg(["node", "x.mjs", "--dry-run", "--impact-out"])).toThrow(/=/);
    expect(() => parseImpactOutArg(["node", "x.mjs", "--dry-run", "--impact-out="])).toThrow(/비었/);
  });
  it("dry-run 과 같이 오면 경로 · 없으면 null", () => {
    expect(parseImpactOutArg(["node", "x.mjs", "--dry-run", "--impact-out=C:/t.json"])).toBe("C:/t.json");
    expect(parseImpactOutArg(["node", "x.mjs", "--dry-run"])).toBeNull();
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
