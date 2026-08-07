// @ts-check
/**
 * collect-applyhome-remndr 회귀 가드 (세션 496, 단계1)
 *
 * ⚠️ 이 테스트들은 **뮤테이션으로 검증됐다** — 각 가드를 일부러 되돌리면 red 가 된다.
 *    (.claude/rules/meta/guards-must-be-mutation-tested.md: "통과는 절반의 검증")
 *
 * 특히 아래 케이스들은 "가드가 진짜 필요한 입력"이라 반드시 남겨둔다.
 * 행복 경로만 두면 가드를 지워도 전부 통과한다(세션 491 noxious 사고):
 *   - parseCmpetRate("(△13)")      → △ 분기를 지우면 rate 가 NaN→null 이 되어 shortfall 이 소실
 *   - parseCmpetRate("2,182.00")   → 콤마 제거를 지우면 NaN
 *   - parseIntLoose("62,342")      → 콤마 제거를 지우면 값 통째 소실 (임의공급 분양가 전멸 경로)
 *   - normHouseTy("084.7500A ")    → trim 을 지우면 조인 키가 어긋남
 *   - buildCancelRow 전 유형 0     → max_rate 를 0 으로 채우면 "미수집"과 구분 불가
 *   - findKeyCollisions            → source 필터를 지우면 자기 자신을 충돌로 오판
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseCmpetRate, parseIntLoose, parseRealLoose, normHouseTy,
  buildUnitRow, buildCancelRow, buildMatched, findKeyCollisions, CANC_TYPES,
} from "./collect-applyhome-remndr.mjs";

const SRC = readFileSync(new URL("./collect-applyhome-remndr.mjs", import.meta.url), "utf8");
// 주석에도 같은 단어가 나오므로 **코드 형태로 좁혀서** 찾는다 — 좌변·괄호까지 고정하지 않으면
// 주석만 남기고 코드를 지워도 통과하는 껍데기가 된다([[guards-must-be-mutation-tested]]).
const CODE = SRC.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

describe("조기 종료 경로도 collector_runs 를 남긴다 (세션 498)", () => {
  // 왜 필요한가: 마이그 미적용·충돌키·API 구조변경으로 try 안에서 return 하면 정상 기록 줄
  // (`await recordCollectorRun(PHASE, result)`)에 도달하지 못해 **행이 아예 안 생긴다**.
  // 행이 없으면 monitor 는 "실패"와 "아예 실행 안 함"을 구분할 수 없어 ①②⑤ 어느 검사에도
  // 안 걸리고, 유일한 신호가 Actions 실패 알림 1회뿐이라 놓치면 매주 조용히 반복된다.
  it("finally 에 미기록 폴백이 배선돼 있다", () => {
    expect(CODE).toMatch(/if\s*\(!runRecorded\)\s*\{/);
    expect(CODE).toMatch(/status:\s*["']failure["']/);
  });

  it("정상 경로가 기록 후 플래그를 세운다 (폴백 중복 기록 차단)", () => {
    expect(CODE).toMatch(/await recordCollectorRun\(PHASE,\s*result\);\s*\n\s*runRecorded = true;/);
  });

  it("조기 종료 3곳이 모두 사유를 남긴다", () => {
    // `let earlyExitReason = null;` 선언부가 같이 잡히지 않게 줄 시작 들여쓰기 뒤 **대입만** 센다
    // (선언까지 세면 대입을 하나 지워도 4→3 이 아니라 3→3 이 되어 가드가 무효).
    const hits = CODE.match(/^\s+earlyExitReason = /gm) ?? [];
    expect(hits.length).toBe(3); // HOUSE_TY 부재 · 마이그 미적용 · 충돌키
  });

  it("폴백이 사유를 errorMessage 로 넘긴다", () => {
    expect(CODE).toMatch(/errorMessage:\s*earlyExitReason/);
  });
});

describe("parseCmpetRate — 청약홈 경쟁률 5형태 (2026-08-07 실측)", () => {
  it("정상 소수 문자열", () => {
    expect(parseCmpetRate("73.00")).toEqual({ rate: 73, shortfall: null });
  });

  it("콤마 낀 경쟁률 — #7 NORMAL_CMPET_RATE 의 20.9%", () => {
    expect(parseCmpetRate("2,182.00")).toEqual({ rate: 2182, shortfall: null });
  });

  it('"-" 는 미접수 — rate·shortfall 둘 다 null', () => {
    expect(parseCmpetRate("-")).toEqual({ rate: null, shortfall: null });
  });

  it('"(△13)" 은 13세대 미달 — rate 는 null 이지만 shortfall 이 살아야 한다', () => {
    expect(parseCmpetRate("(△13)")).toEqual({ rate: null, shortfall: 13 });
  });

  it("△ 표기 변형(괄호·공백 유무)도 흡수", () => {
    expect(parseCmpetRate("△4").shortfall).toBe(4);
    expect(parseCmpetRate("( △ 21 )").shortfall).toBe(21);
  });

  it("null·빈문자·해석 불가 문자열", () => {
    expect(parseCmpetRate(null)).toEqual({ rate: null, shortfall: null });
    expect(parseCmpetRate("")).toEqual({ rate: null, shortfall: null });
    expect(parseCmpetRate("해당없음")).toEqual({ rate: null, shortfall: null });
  });

  it("0.00 은 null 이 아니라 0 — 미달과 구분된다", () => {
    expect(parseCmpetRate("0.00")).toEqual({ rate: 0, shortfall: null });
  });
});

describe("parseIntLoose / parseRealLoose — 콤마 유무가 채널마다 다르다", () => {
  it("콤마 있는 분양가 (임의공급 Mdl 형식)", () => {
    expect(parseIntLoose("62,342")).toBe(62342);
  });

  it("콤마 없는 분양가 (잔여세대 Mdl 형식)", () => {
    expect(parseIntLoose("134190")).toBe(134190);
  });

  it("숫자 타입·0·null·빈문자", () => {
    expect(parseIntLoose(29)).toBe(29);
    expect(parseIntLoose(0)).toBe(0);
    expect(parseIntLoose(null)).toBeNull();
    expect(parseIntLoose("")).toBeNull();
  });

  it("소수는 버림 (세대수 필드 보호)", () => {
    expect(parseIntLoose("12.9")).toBe(12);
  });

  it("실수 파서는 소수를 보존한다 (공급면적)", () => {
    expect(parseRealLoose("112.1000")).toBe(112.1);
    expect(parseRealLoose(null)).toBeNull();
  });
});

describe("normHouseTy — 원문에 트레일링 스페이스가 붙어 온다", () => {
  it('"084.7500A " 끝 공백 제거 — 조인 키가 어긋나지 않게', () => {
    expect(normHouseTy("084.7500A ")).toBe("084.7500A");
  });

  it("공백만 있으면 null", () => {
    expect(normHouseTy("   ")).toBeNull();
    expect(normHouseTy(null)).toBeNull();
  });
});

describe("buildUnitRow — 잔여세대 평형 → applyhome_unit_supply", () => {
  const row = {
    HOUSE_MANAGE_NO: "2026930024", MODEL_NO: "01", HOUSE_TY: "084.7500A ",
    LTTOT_TOP_AMOUNT: "134190", SUPLY_AR: "112.1000", SUPLY_HSHLDCO: 0, SPSPLY_HSHLDCO: 1,
  };

  it("실측 샘플이 그대로 매핑된다", () => {
    expect(buildUnitRow(row, "ah-2026930024")).toEqual({
      apartment_id: "ah-2026930024",
      house_manage_no: "2026930024",
      model_no: "01",
      house_ty: "084.7500A",
      supply_area: 112.1,
      general_supply: 0,
      special_supply: 1,
      special_by_type: null,
      top_amount: 134190,
      source: "remndr",
    });
  });

  it("source 는 항상 remndr — 이 값이 APT 계열과 섞이면 출처 추적이 무너진다", () => {
    expect(buildUnitRow({ HOUSE_MANAGE_NO: "1", MODEL_NO: "01" }, "ah-1").source).toBe("remndr");
  });

  it("SUPLY_AR 은 실측 87.4% 가 null — null 이 정상값이다", () => {
    expect(buildUnitRow({ ...row, SUPLY_AR: null }, "ah-1").supply_area).toBeNull();
  });

  it("special_by_type 은 채우지 않는다 — 이 채널은 유형별 내역을 안 준다", () => {
    expect(buildUnitRow(row, "ah-1").special_by_type).toBeNull();
  });
});

describe("buildCancelRow — 취소후재공급 → applyhome_cancel_respl", () => {
  /** 실측 샘플: 노부모 1세대에 306명 신청, 나머지 유형은 전부 0 */
  const row = {
    HOUSE_MANAGE_NO: "2026930024", PBLANC_NO: "2026930024", MODEL_NO: "01", HOUSE_TY: "084.7500A ",
    SUPLY_HSHLDCO: 1,
    NORMAL_CMPET_RATE: "0.00", NORMAL_HSHLDCO: 0, NORMAL_REQ_CNT: "0",
    INSTT_RECOMEND_CMPET_RATE: "0.00", INSTT_RECOMEND_HSHLDCO: 0, INSTT_RECOMEND_REQ_CNT: "0",
    MNYCH_CMPET_RATE: "0.00", MNYCH_HSHLDCO: 0, MNYCH_REQ_CNT: "0",
    LFE_FRST_CMPET_RATE: "0.00", LFE_FRST_HSHLDCO: 0, LFE_FRST_REQ_CNT: "0",
    NWWDS_CMPET_RATE: "0.00", NWWDS_HSHLDCO: 0, NWWDS_REQ_CNT: "0",
    OLD_PARNTS_SUPORT_CMPET_RATE: "306.00", OLD_PARNTS_SUPORT_HSHLDCO: 1, OLD_PARNTS_SUPORT_REQ_CNT: "306",
  };

  it("값이 있는 유형만 by_type 에 담긴다 (0 뿐인 5유형은 제외)", () => {
    const out = buildCancelRow(row, "ah-2026930024");
    expect(Object.keys(/** @type {object} */ (out.by_type))).toEqual(["old_parnts"]);
    expect(out.by_type).toEqual({ old_parnts: { rate: 306, supply: 1, req: 306 } });
  });

  it("max_rate 는 유형 전체 최고 경쟁률", () => {
    expect(buildCancelRow(row, "ah-1").max_rate).toBe(306);
  });

  it("콤마 낀 경쟁률도 max_rate 에 들어간다", () => {
    const r = { ...row, NORMAL_CMPET_RATE: "2,182.00", NORMAL_HSHLDCO: 1, NORMAL_REQ_CNT: "2182" };
    expect(buildCancelRow(r, "ah-1").max_rate).toBe(2182);
  });

  it("전 유형이 미달/미접수면 max_rate 는 null — 0 으로 채우면 '미수집'과 구분 불가", () => {
    /** @type {Record<string, unknown>} */
    const empty = { HOUSE_MANAGE_NO: "9", MODEL_NO: "01", SUPLY_HSHLDCO: 3 };
    for (const [p] of CANC_TYPES) {
      empty[`${p}_CMPET_RATE`] = "-";
      empty[`${p}_HSHLDCO`] = 0;
      empty[`${p}_REQ_CNT`] = "0";
    }
    const out = buildCancelRow(empty, "ah-9");
    expect(out.max_rate).toBeNull();
    expect(out.by_type).toBeNull();
  });

  it("미달 유형은 rate=null + shortfall 을 함께 보존한다", () => {
    const r = { ...row, NORMAL_CMPET_RATE: "(△2)", NORMAL_HSHLDCO: 5, NORMAL_REQ_CNT: "3" };
    const bt = /** @type {Record<string, { rate: number | null, shortfall?: number }>} */ (buildCancelRow(r, "ah-1").by_type);
    expect(bt.normal.rate).toBeNull();
    expect(bt.normal.shortfall).toBe(2);
  });

  it("미달만 있고 정상 경쟁률이 없으면 max_rate 는 null (미달은 경쟁률이 아니다)", () => {
    /** @type {Record<string, unknown>} */
    const only = { HOUSE_MANAGE_NO: "9", MODEL_NO: "01" };
    for (const [p] of CANC_TYPES) {
      only[`${p}_CMPET_RATE`] = "-";
      only[`${p}_HSHLDCO`] = 0;
      only[`${p}_REQ_CNT`] = "0";
    }
    only.NORMAL_CMPET_RATE = "(△4)";
    only.NORMAL_HSHLDCO = 4;
    expect(buildCancelRow(only, "ah-9").max_rate).toBeNull();
  });
});

describe("buildMatched — ah-{HOUSE_MANAGE_NO} 직접 매칭", () => {
  const rows = [
    { HOUSE_MANAGE_NO: "111", MODEL_NO: "01" },
    { HOUSE_MANAGE_NO: "222", MODEL_NO: "01" },
    { HOUSE_MANAGE_NO: "222", MODEL_NO: "02" },
  ];

  it("로스터에 있는 공고만 남고 apartment_id 가 붙는다", () => {
    const { built, matchedNos, unmatchedNos } = buildMatched(
      rows, new Set(["ah-222"]), (r, id) => ({ ...r, apartment_id: id }),
    );
    expect(built).toHaveLength(2);
    expect(built.every((b) => b.apartment_id === "ah-222")).toBe(true);
    expect([...matchedNos]).toEqual(["222"]);
    expect([...unmatchedNos]).toEqual(["111"]);
  });

  it("HOUSE_MANAGE_NO 없는 행은 조용히 버린다 (ah- 만 남는 잘못된 id 방지)", () => {
    const { built } = buildMatched(
      [{ MODEL_NO: "01" }], new Set(["ah-"]), (r, id) => ({ ...r, apartment_id: id }),
    );
    expect(built).toHaveLength(0);
  });

  it("로스터가 비면 아무것도 만들지 않는다 (INSERT 0 = 로스터 변화 0 불변식)", () => {
    const { built } = buildMatched(rows, new Set(), (r, id) => ({ ...r, apartment_id: id }));
    expect(built).toHaveLength(0);
  });
});

describe("findKeyCollisions — 마이그가 UNIQUE 를 안 바꾼 근거를 매 run 재검증", () => {
  const newRows = [
    { apartment_id: "ah-1", house_manage_no: "1", model_no: "01" },
    { apartment_id: "ah-2", house_manage_no: "2", model_no: "01" },
  ];

  it("APT 계열과 키가 겹치면 충돌로 잡는다", () => {
    const hits = findKeyCollisions(newRows, [
      { apartment_id: "ah-1", house_manage_no: "1", model_no: "01", source: "apt" },
    ]);
    expect(hits).toEqual([{ key: "ah-1|1|01", existingSource: "apt" }]);
  });

  it("직전 run 이 넣은 remndr 행은 충돌이 아니다 (upsert 대상이므로)", () => {
    const hits = findKeyCollisions(newRows, [
      { apartment_id: "ah-1", house_manage_no: "1", model_no: "01", source: "remndr" },
    ]);
    expect(hits).toEqual([]);
  });

  it("source 가 null 인 기존 행은 apt 로 간주한다 (마이그 DEFAULT 이전 잔재 방어)", () => {
    const hits = findKeyCollisions(newRows, [
      { apartment_id: "ah-2", house_manage_no: "2", model_no: "01", source: null },
    ]);
    expect(hits).toEqual([{ key: "ah-2|2|01", existingSource: "apt" }]);
  });

  it("겹치는 키가 없으면 빈 배열 (2026-08-07 실측 상태)", () => {
    expect(findKeyCollisions(newRows, [
      { apartment_id: "ah-9", house_manage_no: "9", model_no: "01", source: "apt" },
    ])).toEqual([]);
  });
});
