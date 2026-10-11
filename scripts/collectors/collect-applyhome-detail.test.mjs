// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    expect(PAGING_SRC).toMatch(/select\("id, name, region, gu, lat, lng, presale_type, complex_key, naver_presale_no, presale_recruit_date, presale_general_supply, units, unit_source"\),\s*sb,\s*"id",/);
  });

  it("★ select 에 그 키가 실제로 들어 있다 — 없으면 selectAll 이 커서를 못 만들어 throw 한다", () => {
    expect(PAGING_SRC).toContain('select("id, name, region, gu, lat, lng, presale_type, complex_key, naver_presale_no, presale_recruit_date, presale_general_supply, units, unit_source")');
  });

  it("★ 일정 표 정리 읽기도 keyCol \"id\" 를 넘긴다(세션630)", () => {
    expect(PAGING_SRC).toMatch(/select\("id, apartment_id, house_manage_no"\),\s*sb,\s*"id",/);
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
  main,
  gateRegionOf, parseNoticeDecisions, indexNoticeDecisions, matchDetailToAptDetailed, NOTICE_DECISIONS_PATH,
  planNoticeReconcile, evaluateNoticeBreaker, compareNoticePlan, parseNoticeArgs, NOTICE_BREAKER_MAX_ROWS, NOTICE_BREAKER_RATIO,
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
    expect(m?.aptIds).toEqual(["ap-1"]);
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
  it("주소 없으면 시도 게이트 대신 '게이트 모름' 보호 — 이름이 같으면(≥0.95) 매칭", () => {
    const m = matchDetailToApt({ HOUSE_NM: "써밋 더힐" }, APTS);
    expect(m?.aptIds).toEqual(["ap-2"]);
  });
});

// ── 세션630: 공고 → 단지 사람 판정 장치 (설계서 docs/superpowers/plans/2026-10-12-applyhome-notice-decisions.md §7) ──
describe("gateRegionOf — 게이트용 시도(첫 낱말이 시도일 때만)", () => {
  it("정식명·약칭 → 약칭", () => {
    expect(gateRegionOf("경기도 수원시 영통구")).toBe("경기");
    expect(gateRegionOf("경기 수원시")).toBe("경기");
    expect(gateRegionOf("인천광역시 서구")).toBe("인천");
  });
  it("통합 시도는 시군구로 가른다 · 못 가르면 null", () => {
    expect(gateRegionOf("전남광주통합특별시 북구 월출동")).toBe("광주");
    expect(gateRegionOf("전남광주통합특별시 순천시 조례동")).toBe("전남");
    expect(gateRegionOf("전남광주통합특별시 첨단3지구")).toBeNull();
  });
  it("★ 첫 낱말이 시도가 아니면 null — addrToRegion 은 글자를 돌려준다(광역시 오판)", () => {
    expect(gateRegionOf("광주시 탄벌동 123")).toBeNull();
    expect(addrToRegion("광주시 탄벌동 123")).toBe("광주"); // 고치지 않은 옛 함수(backfill 이 기대) — 이 차이가 게이트를 바꾼 이유
    expect(gateRegionOf("김포 풍무지구")).toBeNull();
    expect(gateRegionOf("서울시 성동구")).toBeNull();
    expect(gateRegionOf("경산북도 어딘가")).toBeNull();
    expect(gateRegionOf("광주연구개발특구 첨단3지구 A7블록(전남광주통합특별시 북구 월출동)")).toBeNull();
  });
  it("빈 값 → null · prototype 이름에 속지 않는다", () => {
    expect(gateRegionOf(null)).toBeNull();
    expect(gateRegionOf("")).toBeNull();
    expect(gateRegionOf("constructor 어딘가")).toBeNull();
  });
});

/** 판정 줄 하나(정상) — 시험마다 칸 하나씩 망가뜨린다. @param {Record<string, unknown>} [o] */
const decLine = (o = {}) => ({
  house_manage_no: "2021000727", apartment_id: "ah-1", status: "active",
  names: "공고 ↔ 행", why: "근거", verified_by: "청약홈 원문", approved: "2026-10-12 승인", ...o,
});

describe("parseNoticeDecisions — 사람 판정 파일(거부 7종)", () => {
  it("정상 줄은 받는다 · skip 은 apartment_id null", () => {
    const p = parseNoticeDecisions({ note: "n", updatedAt: "2026-10-12", decisions: [decLine(), decLine({ house_manage_no: "2024000594", apartment_id: null, status: "skip" })] });
    expect(p.decisions).toEqual([
      { house_manage_no: "2021000727", apartment_id: "ah-1", status: "active" },
      { house_manage_no: "2024000594", apartment_id: null, status: "skip" },
    ]);
  });
  it("① 공고번호가 10자리 숫자 글자가 아니면 던진다", () => {
    for (const bad of ["202100072", "20210007270", "2021OOO727", 2021000727, null]) {
      expect(() => parseNoticeDecisions({ decisions: [decLine({ house_manage_no: bad })] })).toThrow(/10자리/);
    }
  });
  it("② status 허용 목록 밖이면 던진다", () => {
    for (const bad of ["keep", "Active", "", null]) {
      expect(() => parseNoticeDecisions({ decisions: [decLine({ status: bad })] })).toThrow(/status/);
    }
  });
  it("③ skip 아닌데 apartment_id 빈칸이면 던진다", () => {
    for (const st of ["active", "rejected"]) {
      for (const bad of [null, "", "  "]) {
        expect(() => parseNoticeDecisions({ decisions: [decLine({ status: st, apartment_id: bad })] })).toThrow(/apartment_id 가 있어야/);
      }
    }
  });
  it("④ skip 인데 apartment_id 가 있으면 던진다", () => {
    expect(() => parseNoticeDecisions({ decisions: [decLine({ status: "skip", apartment_id: "ah-1" })] })).toThrow(/null 이어야/);
  });
  it("⑤ 같은 (공고번호, 행)이 두 번이면 던진다 — 다른 행이면 받는다(active 여러 줄)", () => {
    expect(() => parseNoticeDecisions({ decisions: [decLine(), decLine({ status: "rejected" })] })).toThrow(/두 번/);
    expect(parseNoticeDecisions({ decisions: [decLine(), decLine({ apartment_id: "ah-2" })] }).decisions).toHaveLength(2);
  });
  it("⑥ names·why·verified_by·approved 가 빈칸·공백·글자 아님이면 던진다", () => {
    for (const f of ["names", "why", "verified_by", "approved"]) {
      for (const bad of ["", "   ", null, 3]) {
        expect(() => parseNoticeDecisions({ decisions: [decLine({ [f]: bad })] })).toThrow(new RegExp(f));
      }
    }
  });
  it("⑦ decisions 가 배열이 아니면·파일이 객체가 아니면 던진다", () => {
    expect(() => parseNoticeDecisions({ decisions: {} })).toThrow(/배열/);
    expect(() => parseNoticeDecisions({})).toThrow(/배열/);
    expect(() => parseNoticeDecisions([])).toThrow(/객체/);
    expect(() => parseNoticeDecisions(null)).toThrow(/객체/);
  });
  it("운영 파일 = 10줄(active 3 · skip 7) · 승인 칸이 다 차 있다", () => {
    const p = parseNoticeDecisions(JSON.parse(readFileSync(NOTICE_DECISIONS_PATH, "utf8")));
    expect(p.decisions.filter((d) => d.status === "active").map((d) => `${d.house_manage_no}>${d.apartment_id}`).sort())
      .toEqual(["2021000727>ah-2026910003", "2021000772>ap-6025315", "2023000532>ap-6027298"]);
    expect(p.decisions.filter((d) => d.status === "skip").map((d) => d.house_manage_no).sort())
      .toEqual(["2020001404", "2021000106", "2021000349", "2021000368", "2021000617", "2023000359", "2024000594"]);
  });
});

/** 후보 행 — 기본은 경기 화성시. @param {string} id @param {string} name @param {Record<string, unknown>} [o] */
const apt = (id, name, o = {}) => /** @type {any} */ ({ id, name, region: "경기", gu: "화성시", complex_key: `k:${id}`, ...o });
const NO_DEC = indexNoticeDecisions([]);
/** @param {string} name @param {Record<string, unknown>} [o] */
const notice = (name, o = {}) => /** @type {any} */ ({ HOUSE_MANAGE_NO: "2026000001", HOUSE_NM: name, HSSPLY_ADRES: "경기도 화성시 어딘가", RCRIT_PBLANC_DE: "2026-05-01", TOT_SUPLY_HSHLDCO: "500", ...o });

describe("matchDetailToAptDetailed v3 — 판정 파일 · 제외 · 동점 가르기 · 게이트", () => {
  it("① 판정 파일 active 가 이긴다 · 시도 게이트 면제 · 여러 행", () => {
    const apts = [apt("ah-1", "판정단지"), apt("ah-2", "엉뚱한 단지", { region: "부산" }), apt("ah-3", "또다른", { region: "부산" })];
    const dec = indexNoticeDecisions([
      { house_manage_no: "2026000001", apartment_id: "ah-2", status: "active" },
      { house_manage_no: "2026000001", apartment_id: "ah-3", status: "active" },
    ]);
    const m = matchDetailToAptDetailed(notice("판정단지"), apts, { decisions: dec });
    expect(m.how).toBe("manual");
    expect(m.aptIds).toEqual(["ah-2", "ah-3"]); // 이름이 같은 ah-1 이 아니라 판정 행 · 주소(경기) ↔ 부산이어도 붙는다
  });
  it("판정 행이 apartments 에 없으면 넣지 않는다(manual_missing)", () => {
    const dec = indexNoticeDecisions([{ house_manage_no: "2026000001", apartment_id: "ah-9", status: "active" }]);
    const m = matchDetailToAptDetailed(notice("판정단지"), [apt("ah-1", "판정단지")], { decisions: dec });
    expect(m).toMatchObject({ aptIds: [], how: "manual_missing" });
    expect(matchDetailToApt(notice("판정단지"), [apt("ah-1", "판정단지")], { decisions: dec })).toBeNull();
  });
  it("skip 이면 비운다", () => {
    const dec = indexNoticeDecisions([{ house_manage_no: "2026000001", apartment_id: null, status: "skip" }]);
    expect(matchDetailToAptDetailed(notice("판정단지"), [apt("ah-1", "판정단지")], { decisions: dec })).toMatchObject({ aptIds: [], how: "skip" });
  });
  it("ⓐ (오) 행은 동점에서 빠진다 → 남은 1곳(single)", () => {
    const apts = [apt("ah-1", "가야역 롯데캐슬 스카이엘(오)"), apt("ah-2", "가야역 롯데캐슬 스카이엘")];
    const m = matchDetailToAptDetailed(notice("가야역 롯데캐슬 스카이엘"), apts, { decisions: NO_DEC });
    expect(m).toMatchObject({ aptIds: ["ah-2"], how: "single", excluded: [{ id: "ah-1", why: "officetel" }] });
  });
  it("ⓑ 블록·차수 어긋남은 후보가 1곳뿐이어도 뺀다 → conflict_all", () => {
    const m = matchDetailToAptDetailed(notice("힐스테이트 초월역(1BL)"), [apt("ah-1", "힐스테이트 초월역(2BL)")], { decisions: NO_DEC });
    expect(m).toMatchObject({ aptIds: [], how: "conflict_all", excluded: [{ id: "ah-1", why: "conflict" }] });
  });
  it("ⓑ 글자 블록 어긋남(A8 ↔ A7)도 뺀다", () => {
    const m = matchDetailToAptDetailed(notice("호반써밋 첨단3지구(A8BL)"), [apt("ah-1", "호반써밋 첨단3지구(A7BL)")], { decisions: NO_DEC });
    expect(m.how).toBe("conflict_all");
  });
  it("★ 회차 낱말 (임의공급3차) ↔ (임의공급4차) 는 어긋남이 아니다 — 양쪽 다 떼고 본다", () => {
    const m = matchDetailToAptDetailed(notice("송도 하늘채 아이비원(임의공급3차)"), [apt("ah-1", "송도 하늘채 아이비원(임의공급4차)")], { decisions: NO_DEC });
    expect(m).toMatchObject({ aptIds: ["ah-1"], how: "single" });
  });
  it("★ 제외는 동점 집합을 정한 **뒤** — 최고 유사도 행이 빠지면 낮은 유사도 행으로 넘어가지 않는다", () => {
    // ah-1 = 이름 같음(1.0)·블록 어긋남 / ah-2 = 0.85 이상이지만 더 낮음·어긋남 없음
    const apts = [apt("ah-1", "래미안 센트리폴(2BL)"), apt("ah-2", "래미안 센트리폴스")];
    const m = matchDetailToAptDetailed(notice("래미안 센트리폴(3BL)"), apts, { decisions: NO_DEC });
    expect(m.how).toBe("conflict_all");
    expect(m.aptIds).toEqual([]);
  });
  it("ⓒ rejected 쌍은 뺀다 → 전부 빠지면 rejected_all", () => {
    const dec = indexNoticeDecisions([{ house_manage_no: "2026000001", apartment_id: "ah-1", status: "rejected" }]);
    expect(matchDetailToAptDetailed(notice("거절단지"), [apt("ah-1", "거절단지")], { decisions: dec })).toMatchObject({ aptIds: [], how: "rejected_all" });
    const apts = [apt("ah-1", "거절단지", { complex_key: "K" }), apt("ah-2", "거절단지", { complex_key: "K" })];
    expect(matchDetailToAptDetailed(notice("거절단지"), apts, { decisions: dec })).toMatchObject({ aptIds: ["ah-2"], how: "single" });
  });
  it("같은 묶음 동점 → 첫 행(id 오름차순 — 지금과 같음) · same_bundle", () => {
    const apts = [apt("ah-9", "같은묶음단지", { complex_key: "K" }), apt("ah-3", "같은묶음단지", { complex_key: "K" })];
    expect(matchDetailToAptDetailed(notice("같은묶음단지"), apts, { decisions: NO_DEC })).toMatchObject({ aptIds: ["ah-3"], how: "same_bundle" });
  });
  it("다른 묶음 동점 · 블록 글자로 가름 → tie_block", () => {
    const apts = [apt("ah-1", "호반써밋 첨단3지구"), apt("ah-2", "호반써밋 첨단3지구(A8BL)")];
    expect(matchDetailToAptDetailed(notice("호반써밋 첨단3지구(A8BL)"), apts, { decisions: NO_DEC })).toMatchObject({ aptIds: ["ah-2"], how: "tie_block" });
  });
  it("다른 묶음 동점 · B 가 2묶음이면 못 가름(tie_unresolved) + 후보 명단", () => {
    const apts = [apt("ah-1", "지문없는단지"), apt("ah-2", "지문없는단지")];
    const m = matchDetailToAptDetailed(notice("지문없는단지"), apts, { decisions: NO_DEC });
    expect(m.how).toBe("tie_unresolved");
    expect(m.candidates).toEqual([{ id: "ah-1", name: "지문없는단지", key: "k:ah-1" }, { id: "ah-2", name: "지문없는단지", key: "k:ah-2" }]);
  });
  /** ap 번호 주인 행 + 지문(공고일·일반공급)이 공고 원문과 같다 @param {string} id @param {Record<string, unknown>} [o] */
  const fp = (id, o = {}) => ({ naver_presale_no: id.slice(3), presale_recruit_date: "2026-05-01", presale_general_supply: 500, ...o });
  it("다른 묶음 동점 · 네이버 지문으로 가름(B 없음) → tie_fingerprint", () => {
    // 공고 (1단지) ↔ 우리 두 행 다 차수 없음 = one-sided → B 비어 있음
    const apts = [apt("ap-111", "지문단지", fp("ap-111")), apt("ah-2", "지문단지")];
    expect(matchDetailToAptDetailed(notice("지문단지(1단지)"), apts, { decisions: NO_DEC })).toMatchObject({ aptIds: ["ap-111"], how: "tie_fingerprint" });
  });
  it("글자+지문이 같은 묶음을 가리킴 → tie_both", () => {
    const apts = [apt("ah-2", "지문단지"), apt("ap-111", "지문단지", fp("ap-111"))];
    expect(matchDetailToAptDetailed(notice("지문단지"), apts, { decisions: NO_DEC })).toMatchObject({ aptIds: ["ap-111"], how: "tie_both" });
  });
  it("★ 지문은 ap 번호 주인 행만 — ah 행에 네이버 번호가 달려 있어도 지문 자격 없음 → 못 가름", () => {
    const apts = [apt("ah-111", "지문단지", fp("ah-111", { naver_presale_no: "111" })), apt("ah-2", "지문단지")];
    expect(matchDetailToAptDetailed(notice("지문단지(1단지)"), apts, { decisions: NO_DEC }).how).toBe("tie_unresolved");
  });
  it("★ YYYY-MM 날짜는 지문 불일치 · 일반공급이 다르면 불일치 · 둘 다 null 이면 불일치(Number(null)=0 함정)", () => {
    for (const o of [{ presale_recruit_date: "2026-05" }, { presale_general_supply: 499 }]) {
      const apts = [apt("ap-111", "지문단지", fp("ap-111", o)), apt("ah-2", "지문단지")];
      expect(matchDetailToAptDetailed(notice("지문단지(1단지)"), apts, { decisions: NO_DEC }).how).toBe("tie_unresolved");
    }
    const apts = [apt("ap-111", "지문단지", fp("ap-111", { presale_general_supply: null })), apt("ah-2", "지문단지")];
    expect(matchDetailToAptDetailed(notice("지문단지(1단지)", { TOT_SUPLY_HSHLDCO: null }), apts, { decisions: NO_DEC }).how).toBe("tie_unresolved");
  });
  it("지문이 2묶음이면 못 가름", () => {
    const apts = [apt("ap-111", "지문단지", fp("ap-111")), apt("ap-222", "지문단지", fp("ap-222"))];
    expect(matchDetailToAptDetailed(notice("지문단지(1단지)"), apts, { decisions: NO_DEC }).how).toBe("tie_unresolved");
  });
  it("글자(B)와 지문(F)이 다른 묶음을 가리키면 못 가름", () => {
    const apts = [apt("ah-1", "지문단지(1단지)"), apt("ap-111", "지문단지", fp("ap-111"))];
    expect(matchDetailToAptDetailed(notice("지문단지(1단지)"), apts, { decisions: NO_DEC }).how).toBe("tie_unresolved");
  });
  it("자동 결과 · 주소 시도 ↔ 행 시도가 다르면 게이트 탈락(gate)", () => {
    const m = matchDetailToAptDetailed(notice("써밋 더힐", { HSSPLY_ADRES: "서울특별시 강남구" }), [apt("ap-2", "써밋 더힐", { region: "부산" })], { decisions: NO_DEC });
    expect(m).toMatchObject({ aptIds: [], how: "gate" });
  });
  it("★ 게이트 모름(첫 낱말이 시도 아님) — 유사도 <0.95 · 시군구 불일치면 gate_unknown, 시군구가 주소 앞 두 낱말에 있으면 통과", async () => {
    const { stringSimilarity } = await import("./_shared.mjs");
    const s = stringSimilarity(normName("부산모라 행복주택"), normName("모라 행복주택"));
    expect(s).toBeGreaterThanOrEqual(0.85);
    expect(s).toBeLessThan(0.95);
    const n = notice("부산모라 행복주택", { HSSPLY_ADRES: "김포 풍무지구 어딘가" });
    expect(matchDetailToAptDetailed(n, [apt("ah-1", "모라 행복주택", { region: "부산", gu: "사상구" })], { decisions: NO_DEC }).how).toBe("gate_unknown");
    expect(matchDetailToAptDetailed(n, [apt("ah-1", "모라 행복주택", { region: "경기", gu: "김포시" })], { decisions: NO_DEC })).toMatchObject({ aptIds: ["ah-1"], how: "single" });
    // 유사도 ≥0.95 면 시군구가 달라도 통과("광주시 탄벌동" 꼴 — 이름이 같은 단지)
    const n2 = notice("모라 행복주택", { HSSPLY_ADRES: "광주시 탄벌동" });
    expect(matchDetailToAptDetailed(n2, [apt("ah-1", "모라 행복주택", { region: "경기", gu: "광주시" })], { decisions: NO_DEC }).how).toBe("single");
    expect(matchDetailToAptDetailed(n2, [apt("ah-1", "모라 행복주택", { region: "부산", gu: "사상구" })], { decisions: NO_DEC }).how).toBe("single");
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

// ── main 흐름 (세션623) — 가짜 deps 로 main 을 돌린다. 순수 함수 시험이 못 보는 것:
//    중단(SIGTERM) 건너뜀 · recorded_at 이 KST 날짜인가 · prices 가 평형 적재 뒤인가 · 평형 부분 실패면 prices 를 안 쓰는가.
//    (세션622 적대 검사관: 변이 M7·M8·M10 을 넣어도 시험이 전부 초록이었다)
describe("main 흐름 — 가짜 의존성 (세션623)", () => {
  const DETAILS = [{ HOUSE_MANAGE_NO: "h1", PBLANC_NO: "p1", HOUSE_NM: "흐름시험단지", HSSPLY_ADRES: "경기도 화성시 어딘가", RCRIT_PBLANC_DE: "2026-10-01" }];
  const MDLS = [
    { HOUSE_MANAGE_NO: "h1", MODEL_NO: "01", HOUSE_TY: "084.6120", SUPLY_AR: "112.3", SUPLY_HSHLDCO: "100", SPSPLY_HSHLDCO: "50", LTTOT_TOP_AMOUNT: "59410" },
    { HOUSE_MANAGE_NO: "h1", MODEL_NO: "02", HOUSE_TY: "059.9000", SUPLY_AR: "80.1", SUPLY_HSHLDCO: "40", SPSPLY_HSHLDCO: "10", LTTOT_TOP_AMOUNT: "41000" },
  ];
  const APT_ROWS = [{ id: "a1", name: "흐름시험단지", region: "경기", presale_type: "민간분양" }];

  /**
   * 쿼리 빌더 흉내 — from(표 이름)만 기억하고 나머지 체인은 자기 자신을 돌려준다.
   * @param {(s: any) => unknown} queryFn
   */
  function tableOf(queryFn) {
    let table = "";
    /** @type {any} */
    const chain = new Proxy({}, {
      get: (_t, k) => (/** @type {unknown[]} */ ...args) => {
        if (k === "from") table = String(args[0]);
        return chain;
      },
    });
    queryFn(chain);
    return table;
  }

  /**
   * @param {{ unitsShort?: boolean; interruptOnUnitWrite?: boolean; details?: any[]; mdls?: any[]; apts?: any[];
   *   schedRows?: any[]; schedCount?: number | null; aptCount?: number | null; interruptAt?: number;
   *   files?: Record<string, string> }} [opt]
   *   unitsShort = 평형 upsert 가 한 행 덜 성공 · interruptOnUnitWrite = 평형 쓰는 도중 SIGTERM ·
   *   schedRows = 지금 일정 표(정리 대상) · interruptAt = interrupted() 를 N 번째로 물을 때부터 SIGTERM · files = 가짜 파일(경로 → 내용)
   */
  function makeDeps({
    unitsShort = false, interruptOnUnitWrite = false, details = DETAILS, mdls = MDLS, apts = APT_ROWS,
    schedRows = [], schedCount, aptCount, interruptAt = 0, files = {},
  } = {}) {
    /** @type {{ table: string; rows: any[] }[]} */
    const writes = [];
    let interrupted = false;
    let checks = 0;
    const rpt = {
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(),
      interrupted: () => {
        if (interruptAt && ++checks === interruptAt) interrupted = true;
        return interrupted;
      },
      summary: () => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0, status: interrupted ? "partial" : "success" }),
    };
    /** @type {Record<string, unknown>} */
    const deps = {
      apiKey: "test-key",
      argv: ["node", "collect-applyhome-detail.mjs"],
      getSupabase: () => ({ fake: true }),
      createReporter: () => rpt,
      fetchAllPages: vi.fn(async (/** @type {string} */ op) => (op === "getAPTLttotPblancDetail" ? details : mdls)),
      // apartments·일정 표만 돌려준다 — DB 평형 누적 0행 · prices 0행(= 빈칸이라 채울 대상)
      selectAll: async (/** @type {(s: any) => unknown} */ fn) => {
        const t = tableOf(fn);
        return t === "apartments" ? apts : t === "presale_schedule_official" ? schedRows : [];
      },
      countRows: async (/** @type {unknown} */ _sb, /** @type {string} */ t) =>
        (t === "apartments" ? (aptCount === undefined ? apts.length : aptCount) : (schedCount === undefined ? schedRows.length : schedCount)),
      deleteNoticeRows: vi.fn(async (/** @type {unknown} */ _sb, /** @type {any} */ plan) => {
        writes.push({ table: "delete", rows: plan.deletes });
        return { schedule: plan.deletes.length, units: plan.unitDeletePairs.length, prices: plan.priceDeleteAptIds.length };
      }),
      readFileSync: (/** @type {string} */ p, /** @type {"utf8"} */ enc) => (p in files ? files[p] : readFileSync(p, enc)),
      upsertBatch: async (/** @type {string} */ table, /** @type {any[]} */ rows) => {
        writes.push({ table, rows });
        if (table === "applyhome_unit_supply") {
          if (interruptOnUnitWrite) interrupted = true;
          if (unitsShort) return rows.length - 1;
        }
        return rows.length;
      },
      recordCollectorRun: vi.fn(async () => {}),
      recordApiQuota: vi.fn(async () => {}),
      today: () => "2026-10-10",
    };
    return { deps, writes, rpt };
  }

  /** @param {{ table: string }[]} writes */
  const tables = (writes) => writes.map((w) => w.table);

  /** @type {any} */
  let shared;
  beforeEach(async () => {
    // 가짜가 빠지면 진짜 DB·API 쪽으로 새지 않게 — 모듈 쪽 함수와 fetch 는 불리면 던진다.
    shared = await import("./_shared.mjs");
    for (const name of ["getSupabase", "selectAll", "upsertBatch", "recordCollectorRun", "recordApiQuota"]) {
      vi.mocked(shared[name]).mockReset();
      vi.mocked(shared[name]).mockImplementation(() => { throw new Error(`진짜 ${name} 호출 — 가짜가 빠졌다`); });
    }
    vi.mocked(shared.logError).mockClear();
    vi.stubGlobal("fetch", () => { throw new Error("진짜 fetch 호출 — 외부 API 금지"); });
  });
  afterEach(() => {
    for (const name of ["getSupabase", "selectAll", "upsertBatch", "recordCollectorRun", "recordApiQuota"]) {
      expect(vi.mocked(shared[name])).not.toHaveBeenCalled();
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("기준선 — 일정·평형·prices 를 이 순서로 쓰고, prices 행은 주입한 날짜", async () => {
    const { deps, writes } = makeDeps();
    await main(/** @type {any} */ (deps));
    expect(tables(writes)).toEqual(["presale_schedule_official", "applyhome_unit_supply", "prices"]);
    const prices = writes[2].rows;
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ apartment_id: "a1", house_type: "applyhome_rep", price: 59410, recorded_at: "2026-10-10" });
    expect(deps.recordCollectorRun).toHaveBeenCalledTimes(1);
  });

  it("(1) 평형 쓰는 도중 SIGTERM(interrupted=true) → prices upsert 0회", async () => {
    const { deps, writes } = makeDeps({ interruptOnUnitWrite: true });
    await main(/** @type {any} */ (deps));
    expect(tables(writes)).toContain("applyhome_unit_supply"); // 그 지점까지는 갔다
    expect(tables(writes)).not.toContain("prices");
  });

  it("(2) recorded_at 은 KST 날짜 — UTC 로는 전날인 시각(2026-03-01T15:30Z = KST 03-02 00:30)을 고정", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T15:30:00Z"));
    const { deps, writes } = makeDeps();
    delete deps.today; // 기본값(_shared today = KST)을 그대로 지나게
    await main(/** @type {any} */ (deps));
    const prices = writes.find((w) => w.table === "prices")?.rows ?? [];
    expect(prices).toHaveLength(1);
    expect(prices[0].recorded_at).toBe("2026-03-02"); // UTC 날짜(03-01)면 하루 밀린 것
  });

  it("(3) prices upsert 는 평형 upsert 뒤에 불린다", async () => {
    const { deps, writes } = makeDeps();
    await main(/** @type {any} */ (deps));
    const t = tables(writes);
    expect(t.indexOf("applyhome_unit_supply")).toBeGreaterThanOrEqual(0);
    expect(t.indexOf("prices")).toBeGreaterThan(t.indexOf("applyhome_unit_supply"));
  });

  it("(4) 평형 upsert 일부 실패(반환 < 행 수) → prices upsert 0회 + 오류 로그 한 줄 · 회차는 끝까지", async () => {
    const { deps, writes, rpt } = makeDeps({ unitsShort: true });
    await main(/** @type {any} */ (deps));
    expect(tables(writes)).toEqual(["presale_schedule_official", "applyhome_unit_supply"]);
    /** @type {string[]} */
    const msgs = vi.mocked(shared.logError).mock.calls.map((/** @type {unknown[]} */ c) => String(c[1]));
    expect(msgs.filter((m) => /평형 upsert 일부 실패 1\/2/.test(m))).toHaveLength(1);
    expect(rpt.fail).not.toHaveBeenCalled(); // rpt 수치(일정 행 수)는 그대로
    expect(deps.recordCollectorRun).toHaveBeenCalledTimes(1);
  });

  it("(5) --dry-run 이면 DB 쓰기(일정·평형·prices) 0회 · 실행 기록 1회 · 쿼터 기록 0회", async () => {
    const { deps, writes } = makeDeps();
    deps.argv = ["node", "collect-applyhome-detail.mjs", "--dry-run"];
    await main(/** @type {any} */ (deps));
    expect(writes).toEqual([]);
    expect(deps.recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(deps.recordApiQuota).not.toHaveBeenCalled();
  });

  // ── 세션630: 정리 · 차단기 · 기존 쌍만 모드 ──
  // 일정 표 10행 = 지울 행 1(다른 묶음 x-other 에 붙은 h1) + 이번 API 밖 공고 9행 → 지움 1/10 = 10%(한도 안)
  const ONE_DELETE = [
    { id: 1, apartment_id: "x-other", house_manage_no: "h1" },
    ...Array.from({ length: 9 }, (_, i) => ({ id: i + 2, apartment_id: "a1", house_manage_no: `old${i}` })),
  ];
  // 두 공고: h1 → a1(이미 DB 에 있는 쌍) · h2 → a3(새 쌍) / 일정 표 = (a1,h1) + 다른 묶음 31행(지움 31 > 30)
  const DETAILS2 = [...DETAILS, { HOUSE_MANAGE_NO: "h2", PBLANC_NO: "p2", HOUSE_NM: "새공고단지", HSSPLY_ADRES: "경기도 화성시 저기", RCRIT_PBLANC_DE: "2026-10-02" }];
  const MDLS2 = [...MDLS, { HOUSE_MANAGE_NO: "h2", MODEL_NO: "01", HOUSE_TY: "084.0000", SUPLY_AR: "110", SUPLY_HSHLDCO: "10", SPSPLY_HSHLDCO: "5", LTTOT_TOP_AMOUNT: "50000" }];
  const APT_ROWS2 = [...APT_ROWS, { id: "a3", name: "새공고단지", region: "경기", presale_type: "민간분양" }];
  const BIG_DELETE = [
    { id: 100, apartment_id: "a1", house_manage_no: "h1" },
    ...Array.from({ length: 31 }, (_, i) => ({ id: i + 1, apartment_id: `x-${i}`, house_manage_no: "h1" })),
  ];
  /** @param {{ table: string; rows: any[] }[]} writes @param {string} t */
  const pairsOf = (writes, t) => writes.filter((w) => w.table === t).flatMap((w) => w.rows.map((r) => `${r.apartment_id}|${r.house_manage_no}`));

  it("★ 정리 순서 = 지우기 → 일정 upsert → 평형 upsert → 분양가 (분양가 계획은 지운 뒤 DB 를 읽는다)", async () => {
    const { deps, writes } = makeDeps({ schedRows: ONE_DELETE });
    await main(/** @type {any} */ (deps));
    expect(tables(writes)).toEqual(["delete", "presale_schedule_official", "applyhome_unit_supply", "prices"]);
    expect(writes[0].rows).toEqual([{ id: 1, apartment_id: "x-other", house_manage_no: "h1", why: "other_bundle" }]);
    expect(deps.recordCollectorRun).toHaveBeenCalledWith("applyhome-detail", expect.not.objectContaining({ status: "failure" }));
  });

  it("★ 차단기(지움 31 > 30) → 기존 쌍만: 지우기 0 · 새 쌍 0 · 분양가 0 · failure NTC_BREAKER · exit 1", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(/** @type {any} */ (() => undefined));
    try {
      const { deps, writes } = makeDeps({ details: DETAILS2, mdls: MDLS2, apts: APT_ROWS2, schedRows: BIG_DELETE });
      await main(/** @type {any} */ (deps));
      expect(tables(writes)).toEqual(["presale_schedule_official", "applyhome_unit_supply"]);
      expect(pairsOf(writes, "presale_schedule_official")).toEqual(["a1|h1"]); // 새 쌍 a3|h2 는 승인 전엔 안 넣는다
      expect(new Set(pairsOf(writes, "applyhome_unit_supply"))).toEqual(new Set(["a1|h1"]));
      expect(deps.deleteNoticeRows).not.toHaveBeenCalled();
      expect(deps.recordCollectorRun).toHaveBeenCalledWith("applyhome-detail", expect.objectContaining({ status: "failure", errorMessage: expect.stringMatching(/^NTC_BREAKER /) }));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("--apply-from 이 지금 계획과 같으면 차단기를 넘어도 지우고 넣는다", async () => {
    const plan = { deletes: BIG_DELETE.slice(1).map((r) => ({ id: r.id })), adds: [{ apartment_id: "a3", house_manage_no: "h2" }] };
    const { deps, writes } = makeDeps({ details: DETAILS2, mdls: MDLS2, apts: APT_ROWS2, schedRows: BIG_DELETE, files: { "PLAN.json": JSON.stringify(plan) } });
    deps.argv = ["node", "collect-applyhome-detail.mjs", "--apply-from=PLAN.json"];
    await main(/** @type {any} */ (deps));
    expect(tables(writes)[0]).toBe("delete");
    expect(writes[0].rows).toHaveLength(31);
    expect(pairsOf(writes, "presale_schedule_official").sort()).toEqual(["a1|h1", "a3|h2"]);
    expect(tables(writes)).toContain("prices");
    expect(deps.recordCollectorRun).toHaveBeenCalledWith("applyhome-detail", expect.not.objectContaining({ status: "failure" }));
  });

  it("★ --apply-from 이 지금 계획과 다르면 기존 쌍만 + failure NTC_PLAN_MISMATCH · exit 1", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(/** @type {any} */ (() => undefined));
    try {
      const plan = { deletes: BIG_DELETE.slice(2).map((r) => ({ id: r.id })), adds: [{ apartment_id: "a3", house_manage_no: "h2" }] }; // 한 행 모자람
      const { deps, writes } = makeDeps({ details: DETAILS2, mdls: MDLS2, apts: APT_ROWS2, schedRows: BIG_DELETE, files: { "PLAN.json": JSON.stringify(plan) } });
      deps.argv = ["node", "collect-applyhome-detail.mjs", "--apply-from=PLAN.json"];
      await main(/** @type {any} */ (deps));
      expect(tables(writes)).toEqual(["presale_schedule_official", "applyhome_unit_supply"]);
      expect(pairsOf(writes, "presale_schedule_official")).toEqual(["a1|h1"]);
      expect(deps.recordCollectorRun).toHaveBeenCalledWith("applyhome-detail", expect.objectContaining({ status: "failure", errorMessage: expect.stringMatching(/^NTC_PLAN_MISMATCH /) }));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("★ 매칭 뒤 중단 신호(평형 반복 도중) → 정리 건너뜀(NTC_SKIP): 지우기 0 · failure 아님", async () => {
    // interrupted() 물음 순서 = 매칭 반복 1(공고 1) → 평형 반복 첫 바퀴(2번째)에서 SIGTERM
    const { deps, writes } = makeDeps({ schedRows: ONE_DELETE, interruptAt: 2 });
    await main(/** @type {any} */ (deps));
    expect(deps.deleteNoticeRows).not.toHaveBeenCalled();
    expect(tables(writes)).not.toContain("delete");
    expect(tables(writes)).not.toContain("prices");
    expect(deps.recordCollectorRun).toHaveBeenCalledWith("applyhome-detail", expect.not.objectContaining({ status: "failure" }));
  });

  it("후보 행 수 ≠ apartments count → 정리 건너뜀(NTC_SKIP) · 기존 쌍만", async () => {
    const { deps, writes } = makeDeps({ schedRows: ONE_DELETE, aptCount: 999 });
    await main(/** @type {any} */ (deps));
    expect(deps.deleteNoticeRows).not.toHaveBeenCalled();
    expect(pairsOf(writes, "presale_schedule_official")).toEqual([]); // a1|h1 은 DB 에 없던 새 쌍
    expect(tables(writes)).not.toContain("prices");
  });

  it("일정 표 행 수 ≠ count → 정리 건너뜀", async () => {
    const { deps } = makeDeps({ schedRows: ONE_DELETE, schedCount: 11 });
    await main(/** @type {any} */ (deps));
    expect(deps.deleteNoticeRows).not.toHaveBeenCalled();
  });

  it("★ --dry-run --out 은 계획 파일만 쓰고 DB 쓰기·지우기 0", async () => {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { rmSync } = await import("node:fs");
    const out = join(tmpdir(), `ntc-plan-test-${process.pid}-${Date.now()}.json`);
    try {
      const { deps, writes } = makeDeps({ schedRows: ONE_DELETE });
      deps.argv = ["node", "collect-applyhome-detail.mjs", "--dry-run", `--out=${out}`];
      await main(/** @type {any} */ (deps));
      expect(writes).toEqual([]);
      expect(deps.deleteNoticeRows).not.toHaveBeenCalled();
      const plan = JSON.parse(readFileSync(out, "utf8"));
      expect(plan.deletes.map((/** @type {any} */ d) => [d.id, d.why])).toEqual([[1, "other_bundle"]]);
      expect(plan.adds.map((/** @type {any} */ a) => `${a.apartment_id}|${a.house_manage_no}`)).toEqual(["a1|h1"]);
      expect(plan.keep.not_in_api).toBe(9);
      // 같은 경로로 다시 → API 호출 전에 던진다(승인했을 수 있는 계획 파일을 덮어쓰지 않는다)
      const again = makeDeps({ schedRows: ONE_DELETE });
      again.deps.argv = ["node", "collect-applyhome-detail.mjs", "--dry-run", `--out=${out}`];
      await expect(main(/** @type {any} */ (again.deps))).rejects.toThrow(/이미 있다/);
      expect(again.deps.fetchAllPages).not.toHaveBeenCalled();
    } finally {
      rmSync(out, { force: true });
    }
  });

  it("★ 판정 파일이 깨졌으면 API 호출 전에 NTC_ERROR 로 멈춘다(실행 기록 없음)", async () => {
    const { deps, writes } = makeDeps({ files: { [NOTICE_DECISIONS_PATH]: JSON.stringify({ decisions: [decLine({ why: "" })] }) } });
    await expect(main(/** @type {any} */ (deps))).rejects.toThrow(/^NTC_ERROR /);
    expect(deps.fetchAllPages).not.toHaveBeenCalled();
    expect(deps.recordCollectorRun).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("빈 묶음 열쇠는 열쇠 규칙으로 채워 넘긴다 — 같은 단지 두 행이면 같은 묶음(동점이어도 지우지 않음)", async () => {
    const { withComputedComplexKeys } = await import("./_trade-links.mjs");
    const { parseComplexExceptions } = await import("./_same-complex.mjs");
    const twins = [
      { id: "a1", name: "흐름시험단지", region: "경기", gu: "화성시", lat: 37.2, lng: 127.0, presale_type: "민간분양" },
      { id: "a2", name: "흐름시험단지", region: "경기", gu: "화성시", lat: 37.2001, lng: 127.0001, presale_type: "민간분양" },
    ];
    const ex = parseComplexExceptions({ always: [], isolate: [] });
    const keyed = withComputedComplexKeys(/** @type {any} */ (twins), ex);
    expect(keyed[0].complex_key).toBeTruthy();
    expect(keyed[0].complex_key).toBe(keyed[1].complex_key); // 전제: 규칙이 둘을 한 묶음으로 본다
    const sched = [{ id: 1, apartment_id: "a2", house_manage_no: "h1" }, ...ONE_DELETE.slice(1)];
    const { deps, writes } = makeDeps({ apts: twins, schedRows: sched });
    await main(/** @type {any} */ (deps));
    expect(tables(writes)).not.toContain("delete"); // 채우지 않으면 자기 id 묶음 → 다른 묶음 동점 → 못 가름 → 지움
    expect(pairsOf(writes, "presale_schedule_official")).toEqual(["a1|h1"]);
  });
});

// ── 세션630: 정리 계획(순수 함수) ──
describe("planNoticeReconcile — 양성 증거가 있을 때만 지운다", () => {
  /** @type {Record<string, string>} */
  const KEYS = { "ah-1": "K1", "ah-1b": "K1", "ah-2": "K2", "ah-3": "K3" };
  /** @param {string} id */
  const keyOf = (id) => KEYS[id] ?? id;
  /** @param {string[]} aptIds @param {string} how @param {Record<string, unknown>} [o] */
  const des = (aptIds, how, o = {}) => /** @type {any} */ ({ aptIds, bundles: new Set(aptIds.map(keyOf)), how, ...o });
  const desired = new Map([
    ["H1", des(["ah-1"], "single")],
    ["H2", des([], "skip")],
    ["H3", des(["ah-1"], "single")],
    ["H4", des([], "conflict_all", { excluded: [{ id: "ah-3", why: "conflict" }] })],
    ["H5", des([], "tie_unresolved", { name: "못가름", candidates: [{ id: "ah-2", name: "x", key: "K2" }, { id: "ah-3", name: "x", key: "K3" }] })],
    ["H6", des([], "gate")],
    ["H7", des([], "gate_unknown")],
    ["H8", des([], "noMatch")],
    ["H10", des([], "conflict_all", { excluded: [{ id: "ah-3", why: "officetel" }] })],
    ["H11", des(["ah-1"], "manual")],
    ["H12", des(["ah-1"], "tie_block")],
  ]);
  const dec = indexNoticeDecisions([
    { house_manage_no: "H2", apartment_id: null, status: "skip" },
    { house_manage_no: "H3", apartment_id: "ah-1b", status: "rejected" },
  ]);
  const db = [
    { id: 1, apartment_id: "ah-1b", house_manage_no: "H1" }, // 같은 묶음 추가 행 → 유지
    { id: 2, apartment_id: "ah-2", house_manage_no: "H1" }, // 다른 묶음 → 지움
    { id: 3, apartment_id: "ah-1", house_manage_no: "H1" }, // 이긴 행 → 유지
    { id: 4, apartment_id: "ah-2", house_manage_no: "H2" }, // skip → 지움
    { id: 5, apartment_id: "ah-1b", house_manage_no: "H3" }, // rejected — 같은 묶음이어도 지움
    { id: 6, apartment_id: "ah-3", house_manage_no: "H4" }, // 블록·차수 어긋남 → 지움
    { id: 7, apartment_id: "ah-2", house_manage_no: "H5" }, // 못 가름 → 지움
    { id: 8, apartment_id: "ah-2", house_manage_no: "H6" }, // 게이트 탈락 → 유지 + 명단
    { id: 9, apartment_id: "ah-2", house_manage_no: "H7" }, // 게이트 모름 → 유지 + 명단
    { id: 10, apartment_id: "ah-2", house_manage_no: "H8" }, // 짝 없음 → 유지 + 명단
    { id: 11, apartment_id: "ah-2", house_manage_no: "H9" }, // 이번 API 에 없음 → 손 안 댐
    { id: 12, apartment_id: "ah-3", house_manage_no: "H10" }, // (오) 로 빠진 행은 어긋남이 아님 → 유지 + 명단
    { id: 13, apartment_id: "ah-2", house_manage_no: "H11" }, // 사람 판정 active 가 다른 묶음 → 지움
    { id: 14, apartment_id: "ah-3", house_manage_no: "H12" }, // 글자로 가름 → 다른 묶음 지움
  ];
  const api = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H10", "H11", "H12"]);
  const p = planNoticeReconcile(db, desired, keyOf, api, dec);

  it("지우기 = 다른 묶음·판정·어긋남·못 가름 (id·이유)", () => {
    expect(p.deletes.map((d) => [d.id, d.why])).toEqual([
      [2, "other_bundle"], [4, "decision"], [5, "decision"], [6, "conflict"], [7, "unresolved"], [13, "other_bundle"], [14, "other_bundle"],
    ]);
    expect(p.counts.byWhy).toEqual({ other_bundle: 3, decision: 2, conflict: 1, unresolved: 1 });
  });
  it("★ 같은 묶음 추가 행·게이트 탈락·짝 없음은 유지(명단) · API 밖은 손 안 댐", () => {
    expect(p.keep.same_bundle_extra).toBe(1);
    expect(p.keep.not_in_api).toBe(1);
    expect(p.keep.no_evidence.map((x) => [x.id, x.how])).toEqual([[8, "gate"], [9, "gate_unknown"], [10, "noMatch"], [12, "conflict_all"]]);
    expect(p.counts.kept).toBe(1);
  });
  it("넣기 = DB 에 없는 desired 쌍만 · 평형은 지운 쌍 · 분양가는 영향 단지", () => {
    expect(p.adds.map((a) => `${a.apartment_id}|${a.house_manage_no}|${a.how}`).sort()).toEqual(["ah-1|H11|manual", "ah-1|H12|tie_block", "ah-1|H3|single"]);
    expect(p.unitDeletePairs).toEqual(p.deletes.map((d) => ({ apartment_id: d.apartment_id, house_manage_no: d.house_manage_no })));
    expect(p.priceDeleteAptIds).toEqual(["ah-1b", "ah-2", "ah-3"]);
  });
  it("못 가름 명단에 후보가 실린다", () => {
    expect(p.unresolved).toEqual([{ hmn: "H5", name: "못가름", candidates: [{ id: "ah-2", name: "x", key: "K2" }, { id: "ah-3", name: "x", key: "K3" }] }]);
  });
});

describe("evaluateNoticeBreaker — 지우기만 센다(30행 · 10%)", () => {
  it("상수", () => {
    expect(NOTICE_BREAKER_MAX_ROWS).toBe(30);
    expect(NOTICE_BREAKER_RATIO).toBe(0.1);
  });
  it("★ 30행은 통과 · 31행은 걸림(분모 큼)", () => {
    expect(evaluateNoticeBreaker({ remove: 30, existing: 2000 }).tripped).toBe(false);
    expect(evaluateNoticeBreaker({ remove: 31, existing: 2000 }).tripped).toBe(true);
  });
  it("★ 10% 는 통과 · 넘으면 걸림(행 수는 한도 안)", () => {
    expect(evaluateNoticeBreaker({ remove: 10, existing: 100 }).tripped).toBe(false);
    expect(evaluateNoticeBreaker({ remove: 11, existing: 100 }).tripped).toBe(true);
    expect(evaluateNoticeBreaker({ remove: 0, existing: 0 }).tripped).toBe(false);
  });
});

describe("compareNoticePlan · parseNoticeArgs", () => {
  const cur = { deletes: [{ id: 1 }, { id: 2 }], adds: [{ apartment_id: "a", house_manage_no: "h" }] };
  it("같은 집합이면 같음(순서·숫자/글자 id 무관)", () => {
    expect(compareNoticePlan(cur, { deletes: [{ id: "2" }, { id: 1 }], adds: [{ apartment_id: "a", house_manage_no: "h" }] }).same).toBe(true);
  });
  it("지우기·넣기 중 하나라도 다르면 다름", () => {
    expect(compareNoticePlan(cur, { deletes: [{ id: 1 }], adds: cur.adds }).same).toBe(false);
    expect(compareNoticePlan(cur, { deletes: cur.deletes, adds: [] }).same).toBe(false);
    expect(compareNoticePlan(cur, { deletes: cur.deletes, adds: [{ apartment_id: "a", house_manage_no: "h2" }] }).onlyApproved).toHaveLength(1);
  });
  it("계획 파일 꼴이 틀리면 던진다", () => {
    expect(() => compareNoticePlan(cur, { deletes: [] })).toThrow(/deletes·adds/);
    expect(() => compareNoticePlan(cur, null)).toThrow(/deletes·adds/);
  });
  it("인자 — --out 은 dry-run 전용 · --apply-from 은 dry-run 과 같이 못 씀 · = 필수", () => {
    expect(parseNoticeArgs(["node", "x", "--dry-run", "--out=a.json"])).toEqual({ out: "a.json", applyFrom: null });
    expect(parseNoticeArgs(["node", "x", "--apply-from=p.json"])).toEqual({ out: null, applyFrom: "p.json" });
    expect(() => parseNoticeArgs(["node", "x", "--out=a.json"])).toThrow(/dry-run/);
    expect(() => parseNoticeArgs(["node", "x", "--dry-run", "--apply-from=p.json"])).toThrow(/dry-run/);
    expect(() => parseNoticeArgs(["node", "x", "--dry-run", "--out", "a.json"])).toThrow(/=/);
    expect(() => parseNoticeArgs(["node", "x", "--dry-run", "--out="])).toThrow(/비었/);
    expect(() => parseNoticeArgs(["node", "x", "--apply-from=a", "--apply-from=b"])).toThrow(/두 번/);
  });
});
