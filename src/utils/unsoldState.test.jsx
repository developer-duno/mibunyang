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
 * 옛 카드 칩(9cccd36a^ src/constants/cardChips.ts — PR-3 전)이 이 44곳에 만든 미분양 계열 칩 수(OPTS.nowYm 202611 고정).
 * 세션692: 옛 파일을 임시로 불러 두 모양 모두 칩 배열 전체가 지금 것과 같음을 확인하고 이 수를 적었다 — 지금 함수끼리 맞대지 않는다.
 */
const OLD_UNSOLD_CHIP_TALLY = { moveInDone: 10, moveInLate: 20, moveInSoon: 10, moveInUnknown: 2, unsoldEvent: 30 };
const UNSOLD_CHIP_IDS = new Set([
  "moveInUnknown",
  "moveInDone",
  "moveInLate",
  "moveInSoon",
  "unsoldHigh",
  "unsoldEvent",
  "unsoldListedHidden",
]);
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
    /** @type {Record<string, number>} */
    const chipTally = {};
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
      for (const c of chips) if (UNSOLD_CHIP_IDS.has(c.id)) chipTally[c.id] = (chipTally[c.id] ?? 0) + 1;
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
    // 미분양 계열 칩 수 = 옛 칩 함수가 낸 수(고정 기대값 — 세션692 PR-4, BACKLOG A-28 (c))
    expect(Object.fromEntries(Object.entries(chipTally).sort())).toEqual(OLD_UNSOLD_CHIP_TALLY);
  });
});
