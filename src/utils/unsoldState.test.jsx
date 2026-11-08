// 미분양 상태 문구표·판정(unsoldState.mjs) 시험 (세션689 PR-3 · 설계서 2026-11-01 govlist §2·§6).
//
// 막는 것:
//  ① 칸이 없는 단지(운영 DB 에 VIEW 새 칸 적용 전 — 지금 운영 JSON 전부)의 화면이 한 글자라도 바뀐다.
//     → 운영 자료에서 뽑은 진짜 단지 44곳(aptStaticBody.fixture.json)을 칸 없음 · 칸 있음(false) 두 모양으로 돌려
//       칩·필터·상세·편차 막대 끝 글자·점수 detail·정적 장 줄이 **옛 식**과 같은지 본다(옛 식은 이 파일에 그대로 적었다).
//  ② 등재·비공개 단지가 자리마다 다른 말을 한다(칩 「비공개」, 정적 장 「—」 같은 모순) — 같은 문구표에서 나오는지.
//  ③ 점수 detail 문구가 sanitize(engine.ts)를 지나며 사라진다 — calcCats 경유로만 본다(score-meaning 규칙 §7).
import { describe, it, expect } from "vitest";
import FIX from "./aptStaticBody.fixture.json";
import {
  UNSOLD_LIST_AGENCY,
  UNSOLD_STATE_LABEL,
  UNSOLD_DEVIATION_HIDDEN_TEXT,
  countsAsUnsold,
  isUnsoldListedHidden,
  unsoldFieldLabel,
  unsoldListSource,
  unsoldStateOf,
} from "./unsoldState.mjs";
import * as N from "./aptStaticBody.mjs";
import { nearbyUnsoldText } from "./nearbyComplexes.mjs";
import { FIELD_META } from "@/constants/fieldMeta";
import { buildCardChips } from "@/constants/cardChips";
import { CARD_DEVIATION_FIELDS } from "@/constants/deviationFields";
import { computeDeviation, withMissingText, deviationAriaLabel } from "@/lib/deviation";
import { calcAll, calcCats } from "@/scoring/engine";

const ROWS = /** @type {Array<Record<string, any>>} */ (FIX.data);
const UNSOLD_SPEC = /** @type {any} */ (CARD_DEVIATION_FIELDS.find((f) => f.field === "unsoldRate"));
const OPTS = { isLoggedIn: true, showDeviation: true, nowYm: "202611" };

/** 대구 두류센트레빌 더 파크(ah-2025910146) 꼴 — 픽스처의 대구 행(ah-2021910084)에 명단 칸만 얹는다 */
const DAEGU = /** @type {Record<string, any>} */ (ROWS.find((r) => r.id === "ah-2021910084"));
const DURYU = {
  ...DAEGU,
  unsold: null,
  unsoldRate: null,
  unsoldSource: "govlist",
  unsoldListedHidden: true,
  unsoldListedAsOf: "2026-09-30",
};

// ── 옛 식(세션689 이전 코드 그대로) ──
/** 옛 FIELD_META.unsold.fmt */
const oldField = (/** @type {any} */ v) => (v != null && v > 0 ? `${v.toLocaleString("ko-KR")}세대` : "—");
/** 옛 nearbyUnsoldText(인근 단지 칩 글자 — 9cccd36a^ src/utils/nearbyComplexes.mjs:76 그대로) */
const oldNearby = (/** @type {any} */ v) => {
  if (v == null) return "미분양 —";
  const n = Number(v);
  if (n > 0) return `미분양 ${n.toLocaleString("ko-KR")}세대`;
  if (n === 0) return "분양 완료";
  return "미분양 —";
};
/**
 * 옛 카드 칩(9cccd36a^ src/constants/cardChips.ts — PR-3 전)이 이 44곳에 만든 칩 id 배열 전체(OPTS 그대로 · 세션692 PR-4 보완 S5).
 * 지금 함수끼리 맞대지 않는다 — 옛 파일이 낸 값을 그대로 적었다. 같은 세션에 칩 배열 전체(글자·색까지)도 옛 함수와 같음을 확인했다.
 * 칩 id 는 실행 시각과 무관(2026-11-04·2027-06-01·실제 시각 셋 다 같음)이라 시각을 고정하지 않는다.
 * 재현: git show 9cccd36a^:src/constants/cardChips.ts > src/constants/__cardChipsOld.tmp.ts 뒤, 임시 시험에서
 *   ROWS.map((r) => [r.id, oldBuild(r, calcAll(r, "live"), OPTS).map((c) => c.id)]) 를 찍어 이 표와 맞댄다(임시 파일 둘 다 지운다).
 * 칩 규칙을 일부러 바꾼 PR 이면 이 표를 새로 찍되, 바뀐 행을 PR 본문에 적는다.
 */
// 한 단지 한 줄(검토·대조용) — 포매터가 펼치지 않게:
// prettier-ignore
const OLD_CHIP_IDS = /** @type {Record<string, string[]>} */ ({
  "ah-2025910101": ["presaleStage", "moveInSoon", "priceCompare", "locationInfo", "riskGrade", "schoolWalkNear", "parking", "exclusiveRatio", "noxiousFact", "unsoldEvent"],
  "ap-6028727": ["presaleStage", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalkNear"],
  "ah-2022910046": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "schoolWalk", "parkingHigh", "exclusiveHigh", "noxiousSafe", "crimeGood", "unsoldEvent"],
  "ap-6028729": ["presaleStage", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalk", "schoolLow"],
  "ah-2024910225": ["presaleStage", "moveInSoon", "priceCompare", "locationInfo", "riskGrade", "parkingHigh", "exclusiveRatio", "crimeCaution", "unsoldEvent"],
  "ap-6025734": ["presaleStage", "moveInSoon", "fairPriceDetail", "locationInfo", "riskGrade", "exclusiveRatio", "crimeCaution"],
  "ah-2020910030": ["moveInDone", "priceCompare", "locationInfo", "riskGrade", "schoolWalk", "parking", "exclusiveRatio", "dsrPass", "noxiousFact", "unsoldEvent"],
  "ah-2020910004": ["moveInDone", "fairPriceDetail", "locationInfo", "riskGrade", "transitDev", "schoolWalkNear", "parkingHigh", "noxiousSafe", "unsoldEvent"],
  "ah-2020910002": ["moveInDone", "priceCompare", "locationInfo", "riskGrade", "transitDev", "schoolWalk", "parkingLow", "corridor", "dsrPass", "noxiousFact", "unsoldEvent"],
  "ah-2020910035": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "transitDev", "schoolWalk", "parking", "exclusiveHigh", "dsrPass", "noxiousFact", "crimeCaution", "unsoldEvent"],
  "ah-2020910006": ["moveInDone", "priceCompare", "locationInfo", "riskGrade", "transitDev", "schoolWalk", "exclusiveRatio", "noxiousNear", "crimeCaution", "unsoldEvent"],
  "ah-2020910005": ["moveInLate", "fairPriceDetail", "locationInfo", "riskGrade", "transitDev", "schoolWalkNear", "parkingLow", "exclusiveRatio", "northFacing", "dsrPass", "noxiousFact", "crimeGood", "unsoldEvent"],
  "ah-2020910003": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "schoolWalkNear", "jeonseRate", "parking", "exclusiveRatio", "noxiousFact", "crimeCaution", "unsoldEvent"],
  "ah-2020910001": ["moveInLate", "fairPriceDetail", "locationInfo", "riskGrade", "transitDev", "schoolWalk", "parkingLow", "exclusiveRatio", "dsrPass", "noxiousFact", "crimeGood", "unsoldEvent"],
  "ap-6025745": ["presaleStage", "moveInSoon", "fairPriceDetail", "locationInfo", "riskGrade", "exclusiveRatio"],
  "ah-2021910039": ["presaleStage", "moveInDone", "fairPriceDetail", "locationInfo", "riskGrade", "competition", "transitDev", "schoolWalk", "parking", "exclusiveRatio", "noxiousSafe", "crimeCaution", "unsoldEvent"],
  "ah-2021910164": ["presaleStage", "moveInLate", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalkNear", "schoolLow", "parking", "exclusiveHigh", "dsrPass", "noxiousSafe", "crimeCaution", "unsoldEvent"],
  "ap-6021085": ["presaleStage", "moveInSoon", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalkNear", "builderCredit", "noxiousFact", "crimeGood"],
  "ap-6025993": ["presaleStage", "moveInSoon", "fairPriceDetail", "locationInfo", "riskGrade", "transitDev", "schoolWalk", "exclusiveRatio", "noxiousFact", "crimeGood"],
  "ap-6028711": ["presaleStage", "moveInSoon", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalk", "dsrPass"],
  "ah-2025910092": ["presaleStage", "moveInLate", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalk", "schoolLow", "parking", "exclusiveRatio", "crimeGood", "unsoldEvent"],
  "ap-6026864": ["presaleStage", "moveInSoon", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalk", "schoolLow", "exclusiveRatio", "noxiousSafe"],
  "ah-2020910010": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "schoolWalk", "jeonseRate", "parking", "exclusiveRatio", "dsrPass", "noxiousFact", "crimeDanger", "unsoldEvent"],
  "ah-2022930010": ["moveInDone", "priceCompare", "locationInfo", "riskGrade", "transitDev", "schoolWalkNear", "jeonseRate", "parking", "exclusiveRatio", "noxiousFact"],
  "ah-2020910036": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "transitDev", "schoolWalk", "jeonseRate", "parking", "exclusiveRatio", "heatLpg", "dsrPass", "noxiousFact", "crimeCaution", "unsoldEvent"],
  "ah-2021910022": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "schoolWalk", "schoolLow", "parking", "exclusiveRatio", "noxiousSafe", "unsoldEvent"],
  "ah-2021910090": ["moveInLate", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalk", "schoolLow", "parking", "exclusiveRatio", "crimeCaution", "unsoldEvent"],
  "ah-2020910008": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "transitDev", "schoolWalk", "parking", "exclusiveHigh", "noxiousFact", "crimeCaution", "unsoldEvent"],
  "ap-6025318": ["presaleStage", "moveInSoon", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalk", "exclusiveRatio", "noxiousFact"],
  "ah-2020910007": ["moveInDone", "priceCompare", "locationInfo", "riskGrade", "transitDev", "schoolWalkNear", "exclusiveRatio", "noxiousNear", "crimeCaution", "unsoldEvent"],
  "ah-2021910010": ["moveInUnknown", "priceCompare", "locationInfo", "riskGrade", "schoolWalk", "parking", "exclusiveRatio", "heatLpg", "dsrPass", "builderCredit", "noxiousSafe", "crimeGood", "unsoldEvent"],
  "ah-2022910075": ["moveInUnknown", "priceCompare", "locationInfo", "riskGrade", "schoolWalkNear", "jeonseRate", "parking", "exclusiveRatio", "heatLpg", "crimeGood", "unsoldEvent"],
  "ap-6026176": ["moveInDone", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalk", "parking", "exclusiveRatio", "builderCredit", "noxiousFact"],
  "ap-6023608": ["presaleStage", "moveInLate", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalk", "parkingHigh", "exclusiveHigh", "dsrPass", "noxiousFact"],
  "ah-2020910017": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "schoolWalkNear", "schoolLow", "jeonseRate", "parking", "exclusiveRatio", "dsrPass", "noxiousSafe", "crimeDanger", "unsoldEvent"],
  "ah-2021930002": ["moveInLate", "fairPriceDetail", "locationInfo", "riskGrade", "schoolWalk", "schoolLow", "parking", "exclusiveRatio", "noxiousFact", "crimeDanger"],
  "ah-2021910084": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "schoolWalkNear", "parking", "exclusiveRatio", "noxiousFact", "crimeCaution", "unsoldEvent"],
  "ah-2020910009": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "transitDev", "schoolWalkNear", "jeonseRate", "parking", "exclusiveRatio", "dsrPass", "builderCredit", "noxiousFact", "crimeCaution", "unsoldEvent"],
  "ah-2021910042": ["presaleStage", "moveInLate", "priceCompare", "locationInfo", "riskGrade", "competition", "schoolWalk", "jeonseRate", "parkingLow", "exclusiveRatio", "corridor", "dsrPass", "noxiousFact", "crimeDanger", "unsoldEvent"],
  "ah-2020910011": ["moveInDone", "priceCompare", "locationInfo", "riskGrade", "transitDev", "schoolWalkNear", "parking", "exclusiveRatio", "northFacing", "dsrPass", "noxiousFact", "crimeGood", "unsoldEvent"],
  "ah-2024910040": ["presaleStage", "moveInSoon", "priceCompare", "locationInfo", "riskGrade", "schoolWalkNear", "parking", "exclusiveRatio", "builderCredit", "crimeDanger", "unsoldEvent"],
  "ap-6023974": ["presaleStage", "moveInLate", "priceCompare", "locationInfo", "riskGrade", "schoolWalkNear", "jeonseRate", "parking", "exclusiveRatio", "builderCredit", "noxiousFact", "crimeDanger"],
  "ah-2020910023": ["moveInLate", "priceCompare", "locationInfo", "riskGrade", "schoolWalk", "parking", "exclusiveRatio", "noxiousFact", "crimeCaution", "unsoldEvent"],
  "ah-2020910014": ["moveInDone", "priceCompare", "locationInfo", "riskGrade", "schoolWalk", "jeonseRate", "parking", "exclusiveRatio", "noxiousFact", "crimeGood", "unsoldEvent"],
});
/** 옛 「미분양만 보기」 */
const oldFilter = (/** @type {any} */ r) => Number(r.unsold ?? 0) > 0;
/** 옛 scoreRisk 미분양률 info·detail(모름 쪽) */
const OLD_UNKNOWN_INFO = "미분양 자료 없음 (중립)";
const OLD_UNKNOWN_DETAIL = "미분양 자료 없음 (중립 40점)";

const riskUnsoldSub = (/** @type {any} */ apt) =>
  /** @type {any} */ (calcCats(apt).risk.subs.find((s) => s.name === "미분양률"));

describe("unsoldState — 판정", () => {
  it("비공개 판정은 VIEW 칸이 정확히 true 일 때만(칸 없음·false·null·문자열 'true' 는 아님)", () => {
    expect(isUnsoldListedHidden({ unsoldListedHidden: true })).toBe(true);
    for (const v of [undefined, null, false, "true", 1])
      expect(isUnsoldListedHidden({ unsoldListedHidden: v })).toBe(false);
    expect(isUnsoldListedHidden(null)).toBe(false);
  });
  it("「미분양 있음」 = 수 1 이상 또는 명단 비공개(👤 Q8)", () => {
    expect(countsAsUnsold({ unsold: 3 })).toBe(true);
    expect(countsAsUnsold({ unsold: null, unsoldListedHidden: true })).toBe(true);
    expect(countsAsUnsold({ unsold: 0 })).toBe(false);
    expect(countsAsUnsold({ unsold: null })).toBe(false);
    expect(countsAsUnsold({})).toBe(false);
  });
  it("상태 3 — 숫자는 null(표 밖) · 명단 출처 0 은 listedZero · 그 밖 0·모름은 unknown", () => {
    expect(unsoldStateOf(DURYU)).toBe("hidden");
    expect(unsoldStateOf({ unsold: 5 })).toBeNull();
    expect(unsoldStateOf({ unsold: 0, unsoldSource: "govlist" })).toBe("listedZero");
    expect(unsoldStateOf({ unsold: 0, unsoldSource: "kosis" })).toBe("unknown");
    expect(unsoldStateOf({ unsold: null, unsoldSource: "govlist" })).toBe("unknown");
    expect(unsoldStateOf({})).toBe("unknown");
  });
});

describe("unsoldState — 기관·달", () => {
  it("대구 2026-09-30 → 대구시 · 2026년 9월", () => {
    expect(unsoldListSource(DURYU)).toEqual({ agency: "대구시", year: 2026, month: 9 });
  });
  it("충남 → 충남도 · 표에 없는 시도는 기관 없음", () => {
    expect(unsoldListSource({ region: "충남", unsoldListedAsOf: "2026-06-30" })).toEqual({
      agency: "충남도",
      year: 2026,
      month: 6,
    });
    expect(unsoldListSource({ region: "경기", unsoldListedAsOf: "2026-06-30" }).agency).toBeNull();
    expect(Object.keys(UNSOLD_LIST_AGENCY).sort()).toEqual(["대구", "충남"]);
  });
  it("기준월이 꼴이 아니거나 달이 1~12 밖이면 연월 없음(new Date 로 넘기지 않는다)", () => {
    for (const v of [null, undefined, "202609", "2026-13-01", "2026-00-10", "abc", 20260930])
      expect(unsoldListSource({ region: "대구", unsoldListedAsOf: v })).toEqual({
        agency: "대구시",
        year: null,
        month: null,
      });
  });
});

describe("문구표 — 등재·비공개(두류) 최종 글자", () => {
  const s = unsoldListSource(DURYU);
  it("칩 「미분양 수 비공개 · 대구시 9월 명단」 · 상세 「비공개 (대구시 2026년 9월말 명단)」(👤 Q7)", () => {
    expect(UNSOLD_STATE_LABEL.hidden.chip?.(s)).toBe("미분양 수 비공개 · 대구시 9월 명단");
    expect(UNSOLD_STATE_LABEL.hidden.field(s)).toBe("비공개 (대구시 2026년 9월말 명단)");
    expect(UNSOLD_STATE_LABEL.hidden.hub(s)).toBe("미분양 비공개 (대구시 2026년 9월말 명단)");
    expect(UNSOLD_STATE_LABEL.hidden.scoreInfo?.(s)).toBe("미분양 수 비공개 (중립)");
    expect(UNSOLD_STATE_LABEL.hidden.scoreDetail?.(s)).toBe("미분양 수 비공개 · 대구시 2026년 9월말 명단 (중립 40점)");
    expect(UNSOLD_DEVIATION_HIDDEN_TEXT).toBe("비공개");
  });
  it("충남은 기관·달만 바뀐다 · 표에 없는 시도는 기관 없이", () => {
    const cn = unsoldListSource({ region: "충남", unsoldListedAsOf: "2026-06-30" });
    expect(UNSOLD_STATE_LABEL.hidden.chip?.(cn)).toBe("미분양 수 비공개 · 충남도 6월 명단");
    const none = unsoldListSource({ region: "경기", unsoldListedAsOf: "2026-06-30" });
    expect(UNSOLD_STATE_LABEL.hidden.chip?.(none)).toBe("미분양 수 비공개");
    expect(UNSOLD_STATE_LABEL.hidden.field(none)).toBe("비공개");
  });
  it("명단 출처 0 = 「0 (대구시 2026-09 명단 미등재)」(설계서 §2 글자) · 달을 모르면 기관만", () => {
    const z = { region: "대구", unsold: 0, unsoldSource: "govlist", unsoldListedAsOf: "2026-09-30" };
    expect(unsoldFieldLabel(0, z)).toBe("0 (대구시 2026-09 명단 미등재)");
    expect(unsoldFieldLabel(0, { ...z, unsoldListedAsOf: null })).toBe("0 (대구시 명단 미등재)");
    expect(unsoldFieldLabel(0, { ...z, region: "경기", unsoldListedAsOf: null })).toBe("0 (명단 미등재)");
  });
});

describe("등재·비공개 단지 — 자리마다 같은 말(모순 0)", () => {
  it("카드 칩 · 상세 · 정적 장 · 편차 막대 · 점수 detail(calcCats 경유)", () => {
    const res = /** @type {any} */ (calcAll(/** @type {any} */ (DURYU), "live"));
    const chip = buildCardChips(/** @type {any} */ (DURYU), res, OPTS).find((c) => c.id === "unsoldListedHidden");
    expect(chip).toEqual({
      id: "unsoldListedHidden",
      text: "미분양 수 비공개 · 대구시 9월 명단",
      tone: "amber",
      layer: "bad",
    });
    expect(FIELD_META.unsold.fmt(DURYU.unsold, DURYU)).toBe("비공개 (대구시 2026년 9월말 명단)");
    expect(N.basicLinesNode(DURYU).join("\n")).toContain("미분양 비공개 (대구시 2026년 9월말 명단)");
    const dev = withMissingText(UNSOLD_SPEC, DURYU, computeDeviation(UNSOLD_SPEC, DURYU.unsoldRate, "대구", null));
    expect(dev).toMatchObject({ state: "missing", text: "비공개" });
    expect(deviationAriaLabel(UNSOLD_SPEC, dev, "대구", "")).toBe("미분양 비공개.");
    const sub = riskUnsoldSub(DURYU);
    expect(sub.info).toBe("미분양 수 비공개 (중립)");
    expect(sub.detail).toBe("미분양 수 비공개 · 대구시 2026년 9월말 명단 (중립 40점)");
    // 점수는 모름 40 그대로(👤 Q3) — 같은 단지의 칸 없는 모양과 서브 점수가 같다
    expect(sub.score).toBe(riskUnsoldSub({ ...DURYU, unsoldListedHidden: undefined }).score);
    expect(calcCats(/** @type {any} */ (DURYU)).risk.total).toBe(
      calcCats(/** @type {any} */ ({ ...DURYU, unsoldListedHidden: undefined })).risk.total
    );
    expect(countsAsUnsold(DURYU)).toBe(true);
  });
});

// ── ① 칸 없는 단지 화면 변화 0 ──
describe("칸 없는 단지(운영 DB 적용 전) — 지금 화면과 같다 · 운영 자료 44곳", () => {
  const variants = [
    ["칸 없음", (/** @type {any} */ r) => r],
    [
      "칸 있음(govlist 아님)",
      (/** @type {any} */ r) => ({ ...r, unsoldSource: "kosis", unsoldListedHidden: false, unsoldListedAsOf: null }),
    ],
  ];
  it.each(variants)("%s", (_name, shape) => {
    expect(ROWS.length).toBe(44);
    let sawUnknownRisk = 0;
    for (const raw of ROWS) {
      const r = /** @type {any} */ (shape)(raw);
      expect(countsAsUnsold(r), r.id).toBe(oldFilter(r));
      expect(FIELD_META.unsold.fmt(r.unsold, r), r.id).toBe(oldField(r.unsold));
      expect(N.unsoldFieldText(r.unsold, r), r.id).toBe(oldField(r.unsold));
      // 인근 단지 칩 글자(세션689 메인 판정 ①) — 행을 넘겨도 옛 호출(행 없음)과 같은 글자
      expect(nearbyUnsoldText(r.unsold, r), r.id).toBe(oldNearby(r.unsold));
      const res = /** @type {any} */ (calcAll(r, "live"));
      const chips = buildCardChips(r, res, OPTS);
      expect(
        chips.map((c) => c.id),
        r.id
      ).not.toContain("unsoldListedHidden");
      // 칩 id 배열 전체 = 옛 칩 함수가 낸 값(고정 스냅샷 — 세션692 PR-4 보완 S5 · BACKLOG A-28 (c))
      expect(
        chips.map((c) => c.id),
        r.id
      ).toEqual(OLD_CHIP_IDS[raw.id]);
      const lines = N.basicLinesNode(r).join("\n");
      expect(lines, r.id).not.toMatch(/비공개|명단/);
      const dev = withMissingText(UNSOLD_SPEC, r, computeDeviation(UNSOLD_SPEC, null, r.region, null));
      expect(dev.text, r.id).toBe("미수집");
      const sub = riskUnsoldSub(r);
      if (r.unsoldRate == null && Number(r.units ?? 0) > 1) {
        sawUnknownRisk++;
        expect(sub.info, r.id).toBe(OLD_UNKNOWN_INFO);
        expect(sub.detail, r.id).toBe(OLD_UNKNOWN_DETAIL);
      }
    }
    // 양성 대조군 — 모름 경로를 실제로 지난 행이 있어야 위 단언이 의미가 있다
    expect(sawUnknownRisk).toBeGreaterThan(0);
    // 스냅샷 표가 44곳 전부를 덮는다(빠진 행은 위 단언이 undefined 와 맞대 빨강)
    expect(Object.keys(OLD_CHIP_IDS).sort()).toEqual(ROWS.map((x) => String(x.id)).sort());
  });
});
