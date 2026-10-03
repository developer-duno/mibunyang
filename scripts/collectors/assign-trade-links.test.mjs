// @ts-check
/**
 * `assign-trade-links.mjs` 시험 — 인자 허용 목록 · 표 없음 처리 · 거래 창 시작 달.
 * 계산 규칙은 `_trade-links.test.mjs` 가 본다(CLI 는 재료를 읽어 넘기고 쓰기만).
 */
import { describe, it, expect } from "vitest";
import { parseArgs, onMissingTable, fromMonthOf, assertOutFree, CONTROL_PROBES, LINK_WINDOW_MONTHS } from "./assign-trade-links.mjs";

const argv = (/** @type {string[]} */ ...a) => ["node", "assign-trade-links.mjs", ...a];

describe("parseArgs — 아는 인자만", () => {
  it("인자 없음 = 미리보기", () => {
    expect(parseArgs(argv())).toEqual({ apply: false, applyFrom: null, out: null });
  });
  it("--apply · --apply-from · --out", () => {
    expect(parseArgs(argv("--apply"))).toEqual({ apply: true, applyFrom: null, out: null });
    expect(parseArgs(argv("--apply-from=C:/x/plan.json"))).toEqual({ apply: true, applyFrom: "C:/x/plan.json", out: null });
    expect(parseArgs(argv("--out=C:/x/new.json"))).toEqual({ apply: false, applyFrom: null, out: "C:/x/new.json" });
  });
  it("--dry-run 을 포함한 모르는 인자는 던진다(기록이 빠지는 사고 — 세션588)", () => {
    expect(() => parseArgs(argv("--dry-run"))).toThrow(/모르는 인자/);
    expect(() => parseArgs(argv("--force"))).toThrow(/모르는 인자/);
  });
  it("--out 은 미리보기에서만 — --apply·--apply-from 과 함께면 던진다", () => {
    expect(() => parseArgs(argv("--apply", "--out=C:/x/a.json"))).toThrow(/--out/);
    expect(() => parseArgs(argv("--apply-from=C:/x/p.json", "--out=C:/x/a.json"))).toThrow(/--out/);
  });
  it("값 없는 --out·--apply-from, 두 번 나온 인자, --apply 와 --apply-from 동시는 던진다", () => {
    expect(() => parseArgs(argv("--out"))).toThrow(/경로/);
    expect(() => parseArgs(argv("--apply-from"))).toThrow(/경로/);
    expect(() => parseArgs(argv("--out=a", "--out=b"))).toThrow(/두 번/);
    expect(() => parseArgs(argv("--apply", "--apply-from=C:/x/p.json"))).toThrow(/같이/);
  });
});

describe("--out 파일이 이미 있으면 던진다", () => {
  it("있는 파일 → 던짐 · 없는 파일·인자 없음 → 통과", () => {
    expect(() => assertOutFree("C:/x/plan.json", () => true)).toThrow(/이미 있습니다/);
    expect(() => assertOutFree("C:/x/plan.json", () => false)).not.toThrow();
    expect(() => assertOutFree(null, () => true)).not.toThrow();
  });
});

describe("표 없음(마이그 전)", () => {
  it("쓰기 실행이면 LINK_NO_TABLE 로 멈추고, 미리보기는 '지금 연결 0' 으로 진행", () => {
    expect(onMissingTable(true)).toEqual({ proceed: false, marker: "LINK_NO_TABLE" });
    expect(onMissingTable(false)).toEqual({ proceed: true, marker: null });
  });
});

describe("거래 창 시작 달(KST)", () => {
  it("2026-10-03 → 12개월 전 202510 · 해 경계 · KST 자정 경계", () => {
    expect(LINK_WINDOW_MONTHS).toBe(12);
    expect(fromMonthOf(new Date("2026-10-03T03:00:00Z"), 12)).toBe("202510");
    expect(fromMonthOf(new Date("2026-01-15T00:00:00Z"), 12)).toBe("202501");
    expect(fromMonthOf(new Date("2026-02-15T00:00:00Z"), 2)).toBe("202512");
    // UTC 로는 9월 30일 16시지만 KST 로는 10월 1일
    expect(fromMonthOf(new Date("2026-09-30T16:00:00Z"), 0)).toBe("202610");
  });
});

describe("대조군 찾기 목록", () => {
  it("10쌍 — 판정에는 쓰지 않는 눈 검수용", () => {
    expect(CONTROL_PROBES.length).toBe(10);
  });
});
