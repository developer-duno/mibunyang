// @ts-check
/**
 * backfill-presale-area-notices.mjs 회귀 가드 — 순수 함수만 검사한다(네트워크·DB 없음).
 *
 * 겨누는 사고:
 *  ① **이름 하한(0.60)을 풀어 남의 단지를 잇는다** — 사전 조사에서 실제로 본 짝:
 *     "병점역서해스카이팰리스3단지" ↔ "여주 서해 스카이팰리스" 0.667.
 *  ② **가격 교차검증을 빼먹는다** — 이름 하한을 0.85 → 0.60 으로 푼 근거가 이 게이트다.
 *     빼면 완화된 이름 매칭이 곧바로 잘못된 면적이 된다.
 *  ③ **가격을 못 쓰는데(임대 공고·저장가 없음) 아무 주택형이나 고른다** — 근거가 이름뿐이면
 *     0.85 + 주택형이 하나뿐일 때만 채워야 한다.
 *  ④ **LH 금액 단위(원)를 만원으로 안 바꾼다** — 3.5억이 35,369만원이 아니라 353,694,000 으로
 *     들어가면 가격 차이가 언제나 문턱을 넘어 게이트가 통째로 무의미해진다(또는 반대로
 *     비교 자체가 거짓이 된다).
 *  ⑤ **임대보증금을 분양가 자리에 넣는다** — LH 는 같은 칸 이름(`LS_GMY`)을 분양 공고에서는
 *     "평균분양가격(원)", 임대 공고에서는 "임대보증금(원)" 으로 쓴다. 라벨을 안 보면 뒤섞인다.
 *  ⑥ VIEW 가 안 고르는 행을 채워 "채웠는데 화면은 그대로" / 이미 있는 값을 덮어씀.
 *  ⑦ `prices` 행이 없는 단지에 행을 만든다(사장님 보류 결정).
 *
 * ⚠️ 문턱값(0.60 · 0.85 · 0.30 · 10000)은 **리터럴로 못 박는다** — 상수에서 읽어 검사하면
 *    상수를 바꿔도 단언이 따라가 아무것도 안 지킨다
 *    (.claude/rules/meta/guards-must-be-mutation-tested.md §"파생 가드는 상수 변경을 못 잡는다").
 *
 * ⚠️ ①③은 순수 함수 단독 호출로는 절반만 잡힌다 — 실전은 `selectCandidates → evaluateCandidate
 *    → chooseBest` 를 순서대로 지나므로 **배선 가드**를 함께 둔다
 *    (같은 룰 §"테스트가 실제 경로를 지나는가").
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  NAME_SIM_MIN,
  NAME_SIM_STRICT,
  LH_WON_PER_MANWON,
  LH_CANDIDATE_CAP,
  noticeRegion,
  stripDistrictSuffix,
  districtHead,
  targetDistrict,
  phaseMarkers,
  phaseConflict,
  blockMarkers,
  blockConflict,
  toApplyhomeUnit,
  parseLhSupplyInfo,
  distinctAreas,
  evaluateCandidate,
  chooseBest,
  toNotice,
  selectCandidates,
  selectNoticeAreaTargets,
} from "./backfill-presale-area-notices.mjs";
import { MAX_PRICE_GAP_RATIO } from "./backfill-presale-area-applyhome.mjs";
import { stringSimilarity } from "./collectors/_shared.mjs";
import { normName } from "./collectors/collect-applyhome-detail.mjs";

const SRC_PATH = fileURLToPath(new URL("./backfill-presale-area-notices.mjs", import.meta.url));

/**
 * 청약홈 주택형 원문 한 줄 (실제 응답 형식 그대로 — 0 패딩·문자열 숫자·콤마).
 * @param {string | null} houseTy
 * @param {string | null} amount
 * @param {string | null} supplyAr
 */
const A = (houseTy, amount, supplyAr) => ({
  HOUSE_TY: houseTy,
  LTTOT_TOP_AMOUNT: amount,
  SUPLY_AR: supplyAr,
});

/**
 * 공통 주택형 형태 한 줄.
 * @param {number} area 전용면적(㎡)
 * @param {number | null} manwon 분양가(만원)
 * @param {number | null} [supply] 공급면적(㎡)
 */
const U = (area, manwon, supply = null) => ({
  house_ty: String(area),
  top_amount: manwon,
  supply_area: supply,
});

/** @param {Array<ReturnType<typeof U>>} rows */
const table = (rows) => ({
  amountRows: rows.filter((r) => r.top_amount != null),
  allRows: rows,
});

/**
 * LH 공급정보 실측 응답(2026-08-27, PAN_ID 0000061158 양주회천 A-26BL).
 * `CCR_CNNT_SYS_DS_CD = "02"` 계열 — 전용면적 칸 이름이 `RSDN_DDO_AR`, 금액이 `SIL_AMT`(원).
 */
const LH_SALE_02 = [
  { dsSch: [{ PAN_ID: "0000061158", CCR_CNNT_SYS_DS_CD: "02", SPL_INF_TP_CD: "050" }] },
  {
    dsList01Nm: [
      {
        RSDN_DDO_AR: "전용면적(㎡)",
        BZDT_NM: "단지명",
        SIL_HSH_CNT: "금회공급세대수",
        HTY_NM: "주택형",
        SPL_AR: "공급면적",
        SIL_AMT: "평균분양가격(원)",
        TOT_HSH_CNT: "세대수",
      },
    ],
    dsList01: [
      { RSDN_DDO_AR: "59.74", BZDT_NM: "양주회천(택) A26", HTY_NM: "59.7400A", SPL_AR: "82.6719", SIL_AMT: "353694000" },
      { RSDN_DDO_AR: "84.86", BZDT_NM: "양주회천(택) A26", HTY_NM: "84.8600A", SPL_AR: "117.4346", SIL_AMT: "487731000" },
    ],
    dsList02: [],
    dsList02Nm: [{ RSDN_DDO_AR: "전용면적(㎡)", LS_GMY: "임대보증금(원)", MM_RFE: "월임대료(원)", SPL_AR: "공급면적" }],
    resHeader: [{ RS_DTTM: "20260827103833", SS_CODE: "Y" }],
  },
];

/**
 * LH 공급정보 실측 응답(PAN_ID 2015122300020425 잔여세대 일반매각).
 * `CCR = "03"` 계열 — 전용면적 `DDO_AR`, 금액 칸 이름이 `LS_GMY` 인데 **라벨은 "평균분양가격(원)"**.
 * 값이 숫자가 아니라 "공고문 참조" 로 오는 흔한 경우도 함께 담았다.
 */
const LH_SALE_03 = [
  { dsSch: [{ PAN_ID: "2015122300020425", CCR_CNNT_SYS_DS_CD: "03" }] },
  {
    dsList01Nm: [
      {
        NOW_HSH_CNT: "금회공급 세대수",
        HSH_CNT: "세대수",
        HTY_NNA: "주택형",
        LS_GMY: "평균분양가격(원)",
        SBD_LGO_NM: "단지명",
        DDO_AR: "전용면적(㎡)",
        SPL_AR: "공급면적",
      },
    ],
    dsList01: [
      { HTY_NNA: "59.89B", LS_GMY: "공고문 참조", DDO_AR: "59.89", SPL_AR: "78.754" },
      { HTY_NNA: "84.96A", LS_GMY: "공고문 참조", DDO_AR: "84.96", SPL_AR: "111.7205" },
    ],
    resHeader: [{ RS_DTTM: "20260827103838", SS_CODE: "Y" }],
  },
];

/**
 * LH 임대 공고 실측 응답(PAN_ID 2015122300020573 대구가람1단지 50년 공공임대).
 * 같은 `LS_GMY` 인데 라벨이 **"임대보증금(원)"** 이다 — 분양가로 쓰면 안 된다.
 * (값은 실측이 "공고문 참조" 였지만, 숫자가 들어와도 안 쓰는지 보려고 여기서는 숫자로 둔다.)
 */
const LH_LEASE = [
  { dsSch: [{ PAN_ID: "2015122300020573", CCR_CNNT_SYS_DS_CD: "03" }] },
  {
    dsList01Nm: [
      {
        RFE: "월임대료(원)",
        NOW_HSH_CNT: "금회공급 세대수",
        HSH_CNT: "세대수",
        HTY_NNA: "주택형",
        LS_GMY: "임대보증금(원)",
        SBD_LGO_NM: "단지명",
        DDO_AR: "전용면적(㎡)",
        SPL_AR: "공급면적",
      },
    ],
    dsList01: [
      { RFE: "250000", HTY_NNA: "55", LS_GMY: "38000000", DDO_AR: "39.99", SPL_AR: "55.0333" },
      { RFE: "310000", HTY_NNA: "67", LS_GMY: "45000000", DDO_AR: "49.97", SPL_AR: "67.4927" },
    ],
    resHeader: [{ RS_DTTM: "20260827103840", SS_CODE: "Y" }],
  },
];

/** LH 임대 공고인데 주택형이 하나뿐인 경우 — (b) 규칙이 쓸 수 있는 유일한 모양. */
const LH_LEASE_SINGLE = [
  {
    dsList01Nm: [{ HTY_NNA: "주택형", LS_GMY: "임대보증금(원)", DDO_AR: "전용면적(㎡)", SPL_AR: "공급면적" }],
    dsList01: [
      { HTY_NNA: "59A", LS_GMY: "38000000", DDO_AR: "59.92", SPL_AR: "83.978" },
      { HTY_NNA: "59A", LS_GMY: "38000000", DDO_AR: "59.92", SPL_AR: "83.978" },
    ],
  },
];

describe("문턱값 — 리터럴 앵커 (⚠️ 뮤테이션 대상)", () => {
  it("이름 유사도 하한 0.60 / 엄격 0.85", () => {
    // 0.60 은 "가격이 뒤에서 교차검증한다"는 전제 위에서만 성립한다. 전제를 바꾸면 이 값도 바꾼다.
    expect(NAME_SIM_MIN).toBe(0.6);
    expect(NAME_SIM_STRICT).toBe(0.85);
  });

  it("가격 차이 문턱 0.30 — 세션532 대조군 실측(10~30% 93.6% → 30~100% 38.7% 절벽)", () => {
    expect(MAX_PRICE_GAP_RATIO).toBe(0.3);
  });

  it("LH 금액 단위 = 원, 우리 저장은 만원 → 10,000", () => {
    expect(LH_WON_PER_MANWON).toBe(10000);
  });

  it("LH 후보 조회 상한 — API 호출 폭발 차단", () => {
    expect(LH_CANDIDATE_CAP).toBe(5);
  });
});

describe("noticeRegion — 시도를 확실히 알 때만", () => {
  it("정식명·약칭 주소에서 약칭 시도를 얻는다", () => {
    expect(noticeRegion("경기도 의정부시 녹양동 일원")).toBe("경기");
    expect(noticeRegion("서울특별시 강동구")).toBe("서울");
    expect(noticeRegion("전북특별자치도")).toBe("전북");
  });

  it("시도를 못 알아본 머리말은 null — 게이트에 쓸 수 없다", () => {
    // addrToRegion 은 접미사만 떼어 "김포"·"전남광주통합특별" 같은 비-시도 문자열을 돌려준다.
    // 그걸 그대로 비교하면 판정이 거짓이 되므로 여기서 걸러야 한다.
    expect(noticeRegion("김포 풍무역세권 B4블록")).toBeNull();
    expect(noticeRegion("전남광주통합특별시")).toBeNull();
    expect(noticeRegion(null)).toBeNull();
    expect(noticeRegion("")).toBeNull();
  });
});

describe("toApplyhomeUnit — 청약홈 주택형 원문", () => {
  it("0 패딩 주택형·문자열 숫자를 그대로 살린다(분양가는 만원)", () => {
    const u = toApplyhomeUnit(A("055.9700A", "79831", "83.6488"));
    expect(u.house_ty).toBe("055.9700A");
    expect(u.top_amount).toBe(79831);
    expect(u.supply_area).toBeCloseTo(83.6488, 4);
  });

  it("콤마가 섞인 금액도 살린다 — Number('62,342') 는 NaN 이라 값이 통째로 사라진다", () => {
    expect(toApplyhomeUnit(A("084.9931D", "62,342", "112.1")).top_amount).toBe(62342);
  });

  it("빈 값은 null", () => {
    const u = toApplyhomeUnit(A(null, null, null));
    expect(u.house_ty).toBeNull();
    expect(u.top_amount).toBeNull();
    expect(u.supply_area).toBeNull();
  });
});

describe("parseLhSupplyInfo — 라벨 사전으로 분양가 칸을 가른다", () => {
  it("⚠️ 뮤테이션 대상 — 금액을 원→만원으로 바꾼다", () => {
    const t = parseLhSupplyInfo(LH_SALE_02);
    // 353,694,000원 = 35,369.4만원. 나누기를 빼면 이 단언이 깨진다.
    expect(t.amountRows[0].top_amount).toBeCloseTo(35369.4, 1);
    expect(t.amountRows[0].top_amount).not.toBe(353694000);
  });

  it("CCR=02 계열(RSDN_DDO_AR/SIL_AMT) 전용·공급면적을 제자리에 담는다", () => {
    const t = parseLhSupplyInfo(LH_SALE_02);
    expect(t.allRows).toHaveLength(2);
    expect(t.allRows[0].house_ty).toBe("59.74");
    expect(t.allRows[0].supply_area).toBeCloseTo(82.6719, 4);
    expect(t.amountRows).toHaveLength(2);
  });

  it("CCR=03 계열(DDO_AR/LS_GMY)도 읽는다 — 금액이 '공고문 참조' 면 금액 없음", () => {
    const t = parseLhSupplyInfo(LH_SALE_03);
    expect(t.allRows.map((r) => r.house_ty)).toEqual(["59.89", "84.96"]);
    expect(t.amountRows).toHaveLength(0); // 면적은 쓰되 가격 교차검증은 못 한다
  });

  it("⚠️ 뮤테이션 대상 — 임대보증금은 분양가가 아니다(라벨로 가른다)", () => {
    // 칸 이름(LS_GMY)은 분양 공고와 똑같다. 라벨을 안 보면 3,800만원짜리 보증금이 분양가가 된다.
    const t = parseLhSupplyInfo(LH_LEASE);
    expect(t.allRows).toHaveLength(2);
    expect(t.amountRows).toHaveLength(0);
    expect(t.allRows.every((r) => r.top_amount == null)).toBe(true);
  });

  it("전용면적 칸이 없는 목록·빈 목록·비배열은 조용히 빈 결과", () => {
    expect(parseLhSupplyInfo([{ dsList01: [], dsList01Nm: [{ DDO_AR: "전용면적(㎡)" }] }]).allRows).toHaveLength(0);
    expect(parseLhSupplyInfo([{ dsList01: [{ X: "1" }], dsList01Nm: [{ X: "기타" }] }]).allRows).toHaveLength(0);
    expect(parseLhSupplyInfo(null).allRows).toHaveLength(0);
    expect(parseLhSupplyInfo({}).allRows).toHaveLength(0);
  });
});

describe("distinctAreas — 서로 다른 전용면적 가짓수", () => {
  it("같은 면적이 여러 줄이면 하나로 센다 — 무엇을 골라도 답이 같다", () => {
    expect(distinctAreas([U(59.92, null), U(59.92, null), U(59.92, null)])).toEqual([59.92]);
  });

  it("상식 범위 밖은 빼고 센다", () => {
    expect(distinctAreas([U(19.9, null), U(300, null), U(84.5, null)])).toEqual([84.5]);
  });

  it("여러 면적은 오름차순으로 전부", () => {
    expect(distinctAreas([U(84.5, null), U(59.9, null)])).toEqual([59.9, 84.5]);
  });
});

describe("evaluateCandidate — (a) 가격 경로", () => {
  const rows = table([U(59.9801, 41796, 84.5775), U(84.9931, 54673, 112.3), U(101.616, 66320, null)]);

  it("저장가에 가장 가까운 주택형을 고른다 — 최저가가 아니다", () => {
    const v = evaluateCandidate(54000, 0.62, rows);
    expect(v.ok).toBe(true);
    expect(v.ok && v.rule).toBe("price");
    expect(v.ok && v.area).toBeCloseTo(84.9931, 4);
    expect(v.ok && v.supplyArea).toBeCloseTo(112.3, 2);
  });

  it("⚠️ 뮤테이션 대상 — 가격 문턱(30%) 경계", () => {
    /** @param {number} amount */
    const run = (amount) => evaluateCandidate(100, 0.62, table([U(59.9801, amount)]));
    expect(run(129).ok).toBe(true); // 29% 통과
    expect(run(130).ok).toBe(true); // 30% 경계는 포함
    const over = run(131);
    expect(over.ok).toBe(false); // 31% 제외
    expect(over.ok === false && over.reason).toBe("farGap");
    expect(run(70).ok).toBe(true); // 반대 방향도 같게
    expect(run(69).ok).toBe(false);
  });

  it("⚠️ 뮤테이션 대상 — 게이트를 없애면 남의 단지 면적이 들어온다", () => {
    // 저장가 1,641 ↔ 공고 42,542 (25배). 게이트가 없으면 59.61㎡ 가 그대로 채워진다.
    const v = evaluateCandidate(1641, 0.67, table([U(59.61, 42542)]));
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("farGap");
  });

  it("이름이 아무리 낮아도 가격이 맞으면 (a) 경로는 통과한다 — 안전장치는 가격이다", () => {
    expect(evaluateCandidate(54000, 0.6, rows).ok).toBe(true);
  });

  it("쓸 수 있는 주택형이 없으면 noValidUnit", () => {
    const v = evaluateCandidate(54000, 0.9, table([U(300, 54000)]));
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("noValidUnit");
  });
});

describe("evaluateCandidate — (b) 단일 주택형 경로", () => {
  const leaseSingle = parseLhSupplyInfo(LH_LEASE_SINGLE);
  const leaseMulti = parseLhSupplyInfo(LH_LEASE);

  it("가격을 못 쓰면(임대 공고) 이름 0.85 미만은 거부", () => {
    const v = evaluateCandidate(54000, 0.84, leaseSingle);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("weakSimNoPrice");
  });

  it("이름 0.85 이상 + 주택형 하나뿐이면 채운다", () => {
    const v = evaluateCandidate(54000, 0.85, leaseSingle);
    expect(v.ok).toBe(true);
    expect(v.ok && v.rule).toBe("single");
    expect(v.ok && v.area).toBeCloseTo(59.92, 2);
    expect(v.ok && v.supplyArea).toBeCloseTo(83.978, 3);
    expect(v.ok && v.gapRatio).toBeNull();
  });

  it("⚠️ 뮤테이션 대상 — 주택형이 여럿이면 고를 근거가 없으므로 거부", () => {
    const v = evaluateCandidate(54000, 1, leaseMulti);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("multiType");
    expect(v.ok === false && v.typeCount).toBe(2);
  });

  it("저장가가 없어도 같은 규칙이 적용된다", () => {
    expect(evaluateCandidate(null, 0.9, leaseSingle).ok).toBe(true);
    expect(evaluateCandidate(null, 0.7, leaseSingle).ok).toBe(false);
    expect(evaluateCandidate(0, 0.9, leaseMulti).ok).toBe(false);
  });
});

describe("chooseBest — 채택 1건", () => {
  /** @param {string} key */
  const N = (key) => ({ src: "applyhome", key, name: key });
  /**
   * @param {number} sim
   * @param {"price" | "single"} rule
   * @param {number} area
   * @param {number | null} gapRatio
   * @param {string} key
   */
  const E = (sim, rule, area, gapRatio, key) => ({
    sim,
    verdict: { ok: true, rule, area, supplyArea: null, matchedAmount: gapRatio == null ? null : 1, gapRatio },
    notice: N(key),
  });
  /** @param {ReturnType<typeof E>[]} rows */
  const pick = (rows) => chooseBest(/** @type {any} */ (rows));

  it("이름이 더 닮았으면 단일 주택형 경로라도 앞선다 — 이름이 정체성이다", () => {
    expect(pick([E(0.99, "single", 50, null, "s"), E(0.61, "price", 84, 0.05, "p")])?.verdict.rule).toBe("single");
  });

  it("이름이 같으면 가격으로 검증된 쪽이 앞선다", () => {
    expect(pick([E(0.9, "single", 50, null, "s"), E(0.9, "price", 84, 0.05, "p")])?.verdict.rule).toBe("price");
  });

  it("이름이 같으면(동률) 가격 차이가 작은 쪽", () => {
    expect(pick([E(0.9, "price", 59, 0.2, "a"), E(0.9, "price", 84, 0.01, "b")])?.verdict.area).toBe(84);
  });

  it("⚠️ 뮤테이션 대상 — 이름이 가격을 이긴다 (힐스테이트고덕 실측)", () => {
    // 이름이 정체성, 가격은 검문. 순서를 되돌리면(가격차 먼저) sim 1.000 짜리 같은 이름 공고가
    // 버려지고 sim 0.696 "힐스테이트 평택역센트럴시티"(다른 단지)가 채택된다 — 2026-08-27 실측.
    const best = pick([E(1.0, "price", 84.39, 0.062, "same-name"), E(0.696, "price", 74.99, 0.019, "other")]);
    expect(best?.verdict.area).toBe(84.39);
    expect(best?.verdict.area).not.toBe(74.99); // 옛 순서가 고르던 값
  });

  it("⚠️ 뮤테이션 대상 — 안양에버포레 실측(0.813/95.36 채택, 0.688/98.996 기각)", () => {
    const best = pick([
      E(0.813, "price", 95.36, 0.052, "everpore-a1"),
      E(0.813, "price", 84.98, 0.204, "everpore-a2"),
      E(0.688, "price", 98.996, 0.005, "urbanpore"),
    ]);
    expect(best?.verdict.area).toBe(95.36); // 같은 sim 안에서는 가격차가 작은 쪽
    expect(best?.verdict.area).not.toBe(98.996); // 옛 순서가 고르던 값(다른 단지)
  });

  it("차이가 같으면 이름이 더 닮은 쪽, 그마저 같으면 키 순 — 재실행 안정", () => {
    const rows = [E(0.7, "price", 59, 0.1, "zzz"), E(0.9, "price", 84, 0.1, "aaa")];
    expect(pick(rows)?.verdict.area).toBe(84);
    expect(pick(rows.slice().reverse())?.verdict.area).toBe(84);
  });

  it("통과한 후보가 없으면 null", () => {
    expect(chooseBest(/** @type {any} */ ([{ sim: 0.9, verdict: { ok: false, reason: "farGap" }, notice: N("x") }]))).toBeNull();
    expect(chooseBest([])).toBeNull();
  });
});

describe("stripDistrictSuffix — 행정 접미 떼기", () => {
  it("특례시·시·군·구를 뗀다", () => {
    expect(stripDistrictSuffix("화성특례시")).toBe("화성");
    expect(stripDistrictSuffix("여주시")).toBe("여주");
    expect(stripDistrictSuffix("가평군")).toBe("가평");
    expect(stripDistrictSuffix("강서구")).toBe("강서");
    expect(stripDistrictSuffix(null)).toBe("");
  });
});

describe("districtHead — 시군구는 사전에 있는 이름만", () => {
  it("주소·gu 어느 쪽에서든 머리를 뽑는다", () => {
    expect(districtHead("경기", "경기도 여주시 교동 산1")).toBe("여주");
    expect(districtHead("서울", "서울특별시 강동구 상일동")).toBe("강동");
    expect(districtHead("경기", "화성시")).toBe("화성");
    expect(districtHead("경기", "수원시 권선구")).toBe("수원"); // 복합 gu 는 앞 토막
  });

  it("특례시 승격 표기를 사전(…시)에 맞춘다", () => {
    expect(districtHead("경기", "경기도 화성특례시 동탄2 택지개발지구 B11BL")).toBe("화성");
  });

  it("⚠️ 뮤테이션 대상 — 사전에 없는 말은 시군구로 치지 않는다", () => {
    // 접미(시·군·구)로 훑으면 "공공주택지구"→"공공주택지", "고덕신도시"→"고덕신도" 가 나와
    // 맞는 짝을 거부한다. 사전 일치라 이런 말은 통째로 무시된다.
    expect(districtHead("인천", "인천검암역세권 공공주택지구 내 B-1BL")).toBeNull();
    expect(districtHead("경기", "고덕신도시 EBC-2BL")).toBeNull();
    expect(districtHead("경기", null)).toBeNull();
    expect(districtHead(null, "경기도 여주시")).toBeNull();
  });
});

describe("targetDistrict — 우리 쪽은 주소부터 본다", () => {
  it("⚠️ 뮤테이션 대상 — gu 가 사전에 없는 일반구면 address 에서 시를 찾는다 (실측)", () => {
    // 운영 실측: 병점역 단지의 gu 는 "병점구"(화성시에 없는 이름) · address 에만 "화성시" 가 있다.
    expect(targetDistrict({ region: "경기", gu: "병점구", address: "경기도 화성시 병점구 병점동" })).toBe("화성");
    expect(targetDistrict({ region: "경기", gu: "덕양구", address: "경기도 고양시 덕양구 행신동" })).toBe("고양");
    expect(targetDistrict({ region: "경기", gu: "동안구", address: "경기도 안양시 동안구 관양동" })).toBe("안양");
  });

  it("address 가 없으면 roadAddress → gu 순으로 내려간다", () => {
    expect(targetDistrict({ region: "경기", gu: "병점구", roadAddress: "경기도 화성시 병점노을6로 18" })).toBe("화성");
    expect(targetDistrict({ region: "경기", gu: "여주시" })).toBe("여주");
  });

  it("어디에도 없으면 null — 게이트를 열어 둔다", () => {
    expect(targetDistrict({ region: "경기", gu: "병점구" })).toBeNull();
    expect(targetDistrict({ region: null, gu: "여주시" })).toBeNull();
  });
});

describe("blockMarkers / blockConflict — 블록 토큰", () => {
  it("접미(BL·블록)가 붙은 것만 센다 — 실측 표기 변형", () => {
    // 2026-08-27 실측: 대상 38곳은 붙여 쓰는 형태뿐(A1BL·A2BL·A4BL),
    // 공고는 A-1블록 217 · A-2블록 130 · 1블록 129 · A-3BL 122 · A1BL 69 · 1BL 65 …
    expect([...blockMarkers("안양에버포레자연&e편한세상 A1BL")]).toEqual(["A1"]);
    expect([...blockMarkers("안양 에버포레 자연앤 e편한세상(A2BL)")]).toEqual(["A2"]);
    expect([...blockMarkers("의정부우정 A-2블록 공공분양주택")]).toEqual(["A2"]);
    expect([...blockMarkers("시흥거모 1블록")]).toEqual(["1"]);
    expect([...blockMarkers("빛가람 S-1블럭")]).toEqual(["S1"]);
  });

  it("접미가 없으면 세지 않는다 — 주소·생활권 표기와 구별이 안 된다", () => {
    // "5-2생활권"·"A-2블록 내 A-1" 같은 토막을 블록으로 읽으면 쓰레기 토큰이 생긴다.
    expect(blockMarkers("세종 5-2생활권 L9").size).toBe(0);
    expect(blockMarkers("힐스테이트 고덕 센트럴").size).toBe(0);
    expect(blockMarkers("대전 하늘채 루시에르(1회차)").size).toBe(0);
    expect(blockMarkers("병점역서해스카이팰리스3단지").size).toBe(0);
    expect(blockMarkers(null).size).toBe(0);
  });

  it("⚠️ 뮤테이션 대상 — A1BL ↔ A2BL 은 다른 블록이라 거부 (실측)", () => {
    expect(blockConflict("안양에버포레자연&e편한세상 A2BL", "안양 에버포레 자연앤 e편한세상(A1BL)")).toBe(true);
    expect(blockConflict("안양에버포레자연&e편한세상 A1BL", "안양 에버포레 자연앤 e편한세상(A1BL)")).toBe(false);
    // 여수 소제지구도 같은 자리 — A4BL 단지가 A3BL 공고를 받으면 안 된다.
    expect(blockConflict("여수소제중흥S-클래스우미린 A4BL", "소제지구 A3BL 중흥S-클래스 우미린")).toBe(true);
  });

  it("⚠️ 뮤테이션 대상 — 문자 접두는 양쪽 다 있을 때만 본다", () => {
    // 공고는 같은 블록을 "A1BL"(69회)로도 "1블록"(129회)으로도 쓴다. 문자를 항상 비교하면
    // A1 ↔ 1 이 어긋난 것으로 읽혀 맞는 짝을 거부한다.
    expect(blockConflict("A1BL", "1블록")).toBe(false);
    expect(blockConflict("A1BL", "1BL")).toBe(false);
    expect(blockConflict("A1BL", "A-1블록")).toBe(false);
    expect(blockConflict("1BL", "2블록")).toBe(true); // 숫자가 다르면 거부
  });

  it("한쪽만 표식이 있으면 통과 — 표기 생략이 흔하다", () => {
    expect(blockConflict("힐스테이트 고덕 센트럴", "고덕신도시 EBC-2BL 힐스테이트 고덕 센트럴")).toBe(false);
    expect(blockConflict("인천영종국제도시디에트르라메르Ⅱ", "인천영종국제도시 디에트르 라 메르Ⅰ(RC4-1,2BL)")).toBe(false);
  });
});

describe("phaseMarkers / phaseConflict — 차수 표식", () => {
  it("로마숫자·N차·N회차·N단지를 숫자로 뽑는다", () => {
    expect([...phaseMarkers("인천영종국제도시디에트르라메르Ⅱ")]).toEqual([2]);
    expect([...phaseMarkers("호반써밋 풍무Ⅲ")]).toEqual([3]);
    expect([...phaseMarkers("병점역서해스카이팰리스3단지")]).toEqual([3]);
    expect([...phaseMarkers("칸타빌레8차")]).toEqual([8]);
    // ⚠️ 원본 이름에서 뽑는다 — normName 이 괄호를 지워 "(2회차)" 가 사라지기 때문(2026-08-27 실측).
    expect([...phaseMarkers("대전 하늘채 루시에르(2회차)")]).toEqual([2]);
  });

  it("표식이 없으면 빈 집합", () => {
    expect(phaseMarkers("여주 서해 스카이팰리스").size).toBe(0);
    expect(phaseMarkers("안양 에버포레 자연앤 e편한세상(A1BL)").size).toBe(0);
    expect(phaseMarkers(null).size).toBe(0);
  });

  it("⚠️ 뮤테이션 대상 — 라메르Ⅱ ↔ 라메르Ⅰ 은 다른 차수라 거부 (실측)", () => {
    expect(
      phaseConflict("인천영종국제도시디에트르라메르Ⅱ", "인천영종국제도시 디에트르 라 메르Ⅰ(RC4-1,2BL)(본청약)"),
    ).toBe(true);
  });

  it("⚠️ 뮤테이션 대상 — 1회차 ↔ (2회차) 도 다른 차수 (실측)", () => {
    expect(phaseConflict("대전하늘채루시에르 1회차", "대전 하늘채 루시에르(2회차)")).toBe(true);
  });

  it("한쪽만 표식이 있으면 통과 — 표기 생략이 흔하다", () => {
    expect(phaseConflict("병점역서해스카이팰리스3단지", "여주 서해 스카이팰리스")).toBe(false);
    expect(phaseConflict("여주 서해 스카이팰리스", "병점역서해스카이팰리스3단지")).toBe(false);
  });

  it("겹치는 표식이 하나라도 있으면 같은 차수", () => {
    expect(phaseConflict("A 3차 2단지", "A Ⅲ")).toBe(false);
    expect(phaseConflict("A 2차", "A 2단지")).toBe(false);
  });
});

describe("selectCandidates — 실전 경로(이름 하한 + 게이트 3중)", () => {
  const notices = [
    toNotice("applyhome", "1", "힐스테이트 고덕 센트럴", "경기도 평택시 고덕면"),
    toNotice("applyhome", "2", "여주 서해 스카이팰리스", "경기도 여주시"),
    toNotice("applyhome", "3", "힐스테이트 고덕 센트럴", "서울특별시 강동구"), // 같은 이름 다른 시도
    toNotice("lh", "4", "고양 창릉 우미 린 그레니티", "김포 어딘가"), // 시도 미해석
    toNotice("applyhome", "5", "인천영종국제도시 디에트르 라 메르Ⅰ(RC4-1,2BL)(본청약)", "인천광역시 중구 운서동"),
    toNotice("applyhome", "6", "대전 하늘채 루시에르(2회차)", "대전광역시 서구 탄방동"),
  ].filter((n) => n != null);

  it("같은 시도 + 이름 하한을 넘는 것만, 유사도 내림차순", () => {
    const cands = selectCandidates({ name: "힐스테이트고덕센트럴", region: "경기", gu: "평택시", price: 56628 }, notices);
    expect(cands.map((c) => c.notice.key)).toEqual(["1"]);
    expect(cands[0].sim).toBe(1);
  });

  it("⚠️ 뮤테이션 대상 — 시군구가 다르면 거부 (병점=화성 ↔ 여주, 실측)", () => {
    // 이름 유사도 0.667 로 하한은 넘고 가격 이격도 19.9% 라 30% 게이트도 통과하던 짝이다.
    // 시군구가 유일하게 이 둘을 가른다.
    //
    // ⚠️ gu 는 운영 실측값 그대로 "병점구" 다 — 화성시에 없는 이름이라 사전에 안 잡힌다.
    //    address 폴백이 빠지면 이 단지는 다시 여주 공고와 짝지어진다(2026-08-27 dry-run 실증).
    const cands = selectCandidates(
      {
        name: "병점역서해스카이팰리스3단지",
        region: "경기",
        gu: "병점구",
        address: "경기도 화성시 병점구 병점동",
        price: 55800,
      },
      notices,
    );
    expect(cands).toHaveLength(0);
  });

  it("시군구를 모르면 막지 않는다 — 1차 방어는 시도 게이트다", () => {
    const cands = selectCandidates(
      { name: "병점역서해스카이팰리스3단지", region: "경기", gu: null, price: 55800 },
      notices,
    );
    expect(cands.map((c) => c.notice.key)).toEqual(["2"]);
  });

  it("⚠️ 뮤테이션 대상 — 차수가 다르면 거부 (라메르Ⅱ ↔ Ⅰ, 실측)", () => {
    // 이름 유사도 0.938 로 아주 높고 가격 이격도 2.7% 인데 **다른 차수**다.
    const cands = selectCandidates(
      { name: "인천영종국제도시디에트르라메르Ⅱ", region: "인천", gu: "중구", price: 61092 },
      notices,
    );
    expect(cands).toHaveLength(0);
  });

  it("⚠️ 뮤테이션 대상 — 차수는 **원본 이름**에서 뽑는다 (1회차 ↔ (2회차), 실측)", () => {
    // 배선 가드다. phaseConflict 단독 테스트로는 못 잡는다 — selectCandidates 가 normName 을
    // 거쳐 넘기도록 되돌리면 "(2회차)" 가 괄호째 사라져 표식이 0이 되고 이 짝이 통과해 버린다.
    // (실제로 그 뮤테이션이 단독 테스트만으로는 green 이었다.)
    const cands = selectCandidates(
      { name: "대전하늘채루시에르 1회차", region: "대전", gu: "서구", price: 76700 },
      notices,
    );
    expect(cands).toHaveLength(0);
  });

  it("같은 차수(표식 없음/한쪽만)면 통과한다", () => {
    const cands = selectCandidates(
      { name: "인천영종국제도시디에트르라메르", region: "인천", gu: "중구", price: 61092 },
      notices,
    );
    expect(cands.map((c) => c.notice.key)).toEqual(["5"]);
  });

  it("⚠️ 뮤테이션 대상 — 0.60 미만 후보는 들이지 않는다", () => {
    // 표본은 **0.30 과 0.60 사이**에 있어야 한다 — 그래야 하한을 0.3 으로 푸는 뮤테이션이 red 가 된다.
    // 훨씬 낮은 이름(예: "동선2구역주택재개발정비사업" ↔ 위 공고들 = 0.000·0.083)을 쓰면
    // 하한을 풀어도 여전히 0 건이라 이 가드가 껍데기가 된다(세션533 실측으로 잡음).
    //   "고덕역스카이" ↔ "여주 서해 스카이팰리스" = 0.375 (2026-08-27 실측)
    expect(stringSimilarity(normName("고덕역스카이"), normName("여주 서해 스카이팰리스"))).toBeCloseTo(0.375, 3);
    const cands = selectCandidates({ name: "고덕역스카이", region: "경기", price: 30000 }, notices);
    expect(cands).toHaveLength(0);
  });

  it("아예 안 닮은 이름도 당연히 0건", () => {
    expect(selectCandidates({ name: "동선2구역주택재개발정비사업", region: "경기", price: 30000 }, notices)).toHaveLength(0);
  });

  it("시도가 다르면 이름이 똑같아도 후보가 아니다 — 동명이지역 차단", () => {
    const cands = selectCandidates({ name: "힐스테이트고덕센트럴", region: "서울", price: 56628 }, notices);
    expect(cands.map((c) => c.notice.key)).toEqual(["3"]);
  });

  it("시도를 못 알아본 공고는 검증할 방법이 없어 제외", () => {
    const cands = selectCandidates({ name: "고양창릉우미린그레니티", region: "경기", price: 53371 }, notices);
    expect(cands.every((c) => c.notice.key !== "4")).toBe(true);
  });

  it("저장가가 없으면 하한이 0.85 로 올라간다", () => {
    // "힐스테이트 고덕 센트럴Ⅱ" ↔ "힐스테이트 고덕 센트럴" 은 0.60~0.85 사이.
    const t = { name: "힐스테이트고덕센트럴에듀포레", region: "경기" };
    const withPrice = selectCandidates({ ...t, price: 50000 }, notices);
    const noPrice = selectCandidates({ ...t, price: null }, notices);
    expect(withPrice.length).toBeGreaterThan(0);
    expect(noPrice).toHaveLength(0);
  });

  it("단지 이름·시도가 비면 후보 0", () => {
    expect(selectCandidates({ name: "", region: "경기", price: 1 }, notices)).toHaveLength(0);
    expect(selectCandidates({ name: "힐스테이트고덕센트럴", region: null, price: 1 }, notices)).toHaveLength(0);
  });
});

describe("실전 경로 통합 — 안양 A1BL/A2BL 이 각자 제 공고를 찾는다", () => {
  // 2026-08-27 운영 실측 그대로. 두 단지의 저장가가 **똑같아서**(100,730) 가격으로는 안 갈리고,
  // normName 이 괄호를 지워 두 공고 이름도 같아진다(sim 동률 0.813). 블록 게이트만이 가른다.
  const A1_UNITS = [
    A("095.3811A", "106040", "123.4494"),
    A("095.3591B", "105970", "123.3792"),
    A("095.9676C", "107560", "125.2286"),
    A("095.9677D", "107560", "125.2287"),
  ];
  const A2_UNITS = [
    A("084.9794A", "80170", "109.7554"),
    A("084.9830B", "79200", "109.5257"),
    A("084.9548C", "78790", "111.2003"),
    A("084.9603D", "80080", "109.6375"),
  ];
  const ADDR = "경기도 안양시 동안구 관양동 521번지 일원";
  const notices = [
    toNotice("applyhome", "2026000125", "안양 에버포레 자연앤 e편한세상(A1BL)", `${ADDR} (안양 관양고 주변 도시개발사업 내 A1BL)`),
    toNotice("applyhome", "2026000126", "안양 에버포레 자연앤 e편한세상(A2BL)", `${ADDR} (안양 관양고 주변 도시개발사업 내 A2BL)`),
  ].filter((n) => n != null);
  /** @param {string} key */
  const unitsOf = (key) => {
    const rows = (key === "2026000125" ? A1_UNITS : A2_UNITS).map(toApplyhomeUnit);
    return { amountRows: rows.filter((r) => r.top_amount != null && r.top_amount > 0), allRows: rows };
  };
  /**
   * 실전과 같은 순서: selectCandidates → evaluateCandidate → chooseBest
   * @param {string} name
   */
  const run = (name) => {
    const target = { name, region: "경기", gu: "동안구", address: "경기도 안양시 동안구 관양동", price: 100730 };
    const cands = selectCandidates(target, notices);
    return chooseBest(
      cands.map((c) => ({
        sim: c.sim,
        verdict: evaluateCandidate(target.price, c.sim, unitsOf(c.notice.key)),
        notice: c.notice,
      })),
    );
  };

  it("⚠️ 뮤테이션 대상 — A1BL 단지는 (A1BL) 공고의 95.3591㎡ (이격 5.2%)", () => {
    const best = run("안양에버포레자연&e편한세상 A1BL");
    expect(best?.notice.key).toBe("2026000125");
    expect(best?.verdict.area).toBeCloseTo(95.3591, 4);
    expect(best?.verdict.matchedAmount).toBe(105970);
    expect((best?.verdict.gapRatio ?? 0) * 100).toBeCloseTo(5.2, 1);
  });

  it("⚠️ 뮤테이션 대상 — A2BL 단지는 (A2BL) 공고의 84.9794㎡ (이격 20.4%)", () => {
    // 게이트가 없으면 sim 동률 + gap 최소 규칙에 밀려 A1BL 의 95.3591㎡ 를 받는다.
    const best = run("안양에버포레자연&e편한세상 A2BL");
    expect(best?.notice.key).toBe("2026000126");
    expect(best?.verdict.area).toBeCloseTo(84.9794, 4);
    expect(best?.verdict.area).not.toBeCloseTo(95.3591, 4); // 게이트 없을 때 들어오던 값
    expect(best?.verdict.matchedAmount).toBe(80170);
    expect((best?.verdict.gapRatio ?? 0) * 100).toBeCloseTo(20.4, 1);
  });

  it("블록 표식이 없는 단지 이름이면 둘 다 후보로 남는다 — 게이트는 한쪽만 있을 때 열린다", () => {
    const target = { name: "안양에버포레자연&e편한세상", region: "경기", gu: "동안구", price: 100730 };
    expect(selectCandidates(target, notices)).toHaveLength(2);
  });
});

describe("selectNoticeAreaTargets — VIEW 가 고르는 행만", () => {
  /** @param {string} id @param {number | null} area */
  const V = (id, area) => ({ id, name: `단지${id}`, region: "경기", area });
  /**
   * @param {number} rowId
   * @param {string} aptId
   * @param {number | null} price
   * @param {string} houseType
   * @param {string} recordedAt
   */
  const P = (rowId, aptId, price, houseType, recordedAt) => ({
    id: rowId,
    apartment_id: aptId,
    area: null,
    price,
    house_type: houseType,
    recorded_at: recordedAt,
  });

  it("면적이 빈 최신 presale 행을 대상으로 잡는다", () => {
    const r = selectNoticeAreaTargets([V("ap-1", null)], [P(1, "ap-1", 54000, "presale_min", "2026-08-01")], new Set());
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0]).toMatchObject({ rowId: 1, aptId: "ap-1", price: 54000 });
  });

  it("이미 면적이 있으면 덮어쓰지 않는다", () => {
    const r = selectNoticeAreaTargets([V("ap-1", 84.5)], [P(1, "ap-1", 54000, "presale_min", "2026-08-01")], new Set());
    expect(r.targets).toHaveLength(0);
    expect(r.alreadyFilled).toBe(1);
  });

  it("청약홈 표가 있으면 다른 스크립트 소관 — 여기서 두 번 손대지 않는다", () => {
    const r = selectNoticeAreaTargets(
      [V("ap-1", null)],
      [P(1, "ap-1", 54000, "presale_min", "2026-08-01")],
      new Set(["ap-1"]),
    );
    expect(r.targets).toHaveLength(0);
    expect(r.hasSupplyRows).toBe(1);
  });

  it("seed 행이 있으면 VIEW 가 그쪽을 고르므로 건드리지 않는다", () => {
    const r = selectNoticeAreaTargets(
      [V("ap-1", null)],
      [P(1, "ap-1", 54000, "presale_min", "2026-08-01"), P(2, "ap-1", 55000, "seed", "2026-01-01")],
      new Set(),
    );
    expect(r.targets).toHaveLength(0);
    expect(r.seedWins).toBe(1);
  });

  it("presale 행이 여럿이면 recorded_at 이 가장 늦은 것만", () => {
    const r = selectNoticeAreaTargets(
      [V("ap-1", null)],
      [P(1, "ap-1", 50000, "presale_min", "2026-06-01"), P(2, "ap-1", 54000, "presale_min", "2026-08-01")],
      new Set(),
    );
    expect(r.targets.map((t) => t.rowId)).toEqual([2]);
    expect(r.targets[0].price).toBe(54000);
  });

  it("⚠️ 뮤테이션 대상 — prices 행이 없으면 대상이 아니다(행 생성 금지)", () => {
    const r = selectNoticeAreaTargets([V("ap-1", null)], [], new Set());
    expect(r.targets).toHaveLength(0);
    expect(r.noPriceRow).toBe(1);
  });

  it("가격이 없거나 0 이면 price=null 로 넘겨 (b) 규칙이 걸리게 한다", () => {
    const r = selectNoticeAreaTargets([V("ap-1", null)], [P(1, "ap-1", 0, "presale_min", "2026-08-01")], new Set());
    expect(r.targets[0].price).toBeNull();
  });

  it("여러 단지가 섞여도 각 무리가 제 칸으로 간다", () => {
    const r = selectNoticeAreaTargets(
      [V("ap-A", null), V("ap-B", 84.5), V("ap-C", null), V("ap-D", null)],
      [
        P(1, "ap-A", 54000, "presale_min", "2026-08-01"),
        P(2, "ap-B", 54000, "presale_min", "2026-08-01"),
        P(3, "ap-C", 54000, "presale_min", "2026-08-01"),
      ],
      new Set(["ap-C"]),
    );
    expect(r.targets.map((t) => t.aptId)).toEqual(["ap-A"]);
    expect(r.alreadyFilled).toBe(1);
    expect(r.hasSupplyRows).toBe(1);
    expect(r.noPriceRow).toBe(1); // ap-D
  });
});

describe("배선 가드 — main 이 실제로 이 함수들을 지나는가", () => {
  const src = readFileSync(SRC_PATH, "utf8");

  // ⚠️ 겨누는 문자열이 파일에 실제로 있는지부터 센다. 없으면 아래 정규식이 무엇을 검사하는지
  //    모르는 채 통과한다(세션531 스트리퍼 사고 답습).
  it("검사 대상 문자열이 소스에 존재한다", () => {
    expect(src.includes("selectCandidates")).toBe(true);
    expect(src.includes("evaluateCandidate")).toBe(true);
    expect(src.includes("chooseBest")).toBe(true);
  });

  it("후보 추리기를 selectCandidates 로 한다", () => {
    // 좌변까지 고정 — `export function selectCandidates(` 선언부에 걸리면 가드가 통째로 무효다.
    expect(src).toMatch(/const\s+cands\s*=\s*selectCandidates\(\s*t\s*,\s*notices\s*\)/);
  });

  it("판정은 evaluateCandidate 가, 저장가·유사도를 받아서 한다", () => {
    expect(src).toMatch(/verdict:\s*evaluateCandidate\(\s*t\.price\s*,\s*c\.sim\s*,\s*units\s*\)/);
  });

  it("채택은 chooseBest 가 한다", () => {
    expect(src).toMatch(/const\s+best\s*=\s*chooseBest\(\s*evaluated\s*\)/);
  });

  it("저장은 VIEW 가 고르는 그 행(rowId)만, area·supply_area 두 칸만 건드린다", () => {
    expect(src).toMatch(/\.update\(\s*\{\s*area:\s*v\.area\s*,\s*supply_area:\s*v\.supplyArea\s*\}\s*\)\.eq\(\s*"id"\s*,\s*d\.t\.rowId\s*\)/);
  });

  it("손님 노출 목록은 임대형을 걷어낸 것이다", () => {
    expect(src).toMatch(/const\s+visible\s*=\s*excludeLeaseUnits\(\s*flat\s*\)/);
  });
});
