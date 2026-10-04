import { describe, it, expect } from "vitest";
import { scoreRisk } from "./scoreRisk";
import { scoreFuture } from "./scoreFuture";
import {
  BUILDER_DEBT_TIERS,
  BUILDER_DEBT_HIGH_ADJ,
  BUILDER_DEBT_UNKNOWN_ADJ,
  POP_GROWTH_TIERS,
  POP_GROWTH_LOW_SCORE,
  CANCEL_RATIO_TIERS,
  CANCEL_RATIO_HIGH_LABEL,
  CANCEL_RATIO_HIGH_SCORE,
} from "@/constants/scoringTiers";
import { SUB_CONTEXT } from "@/constants/subContext";
import type { Apt } from "@/types/scoring";

/**
 * 세션591 — 점수 파일 두 곳의 손글씨 경계를 `scoringTiers.ts` 상수로 옮겼다(분양 탭 눈금이 같은 숫자를
 * 읽게 하려고). **계산 결과는 하나도 바뀌면 안 된다.** 그래서 두 가지를 못 박는다:
 *  ① 옮기기 **전** 식을 이 파일에 그대로 베껴 두고, 경계 바로 위·아래에서 새 점수와 맞댄다.
 *  ② 상수 값 자체를 숫자로 단언한다 — ①만 있으면 상수와 옛 식이 같은 쪽으로 같이 바뀌는 건 못 잡지만
 *     ①의 옛 식은 손글씨라 상수만 바뀌어도 빨강이 된다. ②는 "상수를 고치면서 이 파일 옛 식도 같이
 *     고치는" 경우까지 막는 두 번째 자물쇠다.
 */

// ── 옮기기 전 식 (scoreRisk.ts 세션508 판 그대로) ──
function oldDebtAdj(d: number | null): number {
  return d == null ? 10 : d > 200 ? 20 : d > 150 ? 10 : 0;
}
// ── 옮기기 전 식 (scoreFuture.ts 세션511 판 그대로) ──
function oldPopScore(p: number | null): number {
  return p == null
    ? 35
    : p >= 1.0
      ? 95
      : p >= 0.5
        ? 80
        : p >= 0
          ? 65
          : p >= -0.3
            ? 50
            : p >= -0.8
              ? 35
              : p >= -2.0
                ? 20
                : 10;
}

const base = { id: "t-1", name: "시험단지", region: "경기", gu: "수원시", units: 300 } as unknown as Apt;

const finSub = (d: number | null) =>
  scoreRisk({ ...base, builderCreditGrade: "AA", builderDebtRatio: d } as unknown as Apt).subs.find(
    (s) => s.name === "시공사 재무"
  )!.score;
const popSub = (p: number | null) =>
  scoreFuture({ ...base, popGrowth: p, netMigration: null } as unknown as Apt).subs.find((s) => s.name === "인구")!
    .score;

describe("시공사 부채비율 경계 상수 옮기기 — 점수 변화 0", () => {
  // 신용 AA(0점) 고정이라 재무 위험 = 부채 가산만 → 안전점수 = 100 - 가산
  it.each([null, 0, 49.9, 100, 149.9, 150, 150.1, 171.9, 199.9, 200, 200.1, 551.1])(
    "부채비율 %s 에서 옛 식과 같은 점수",
    (d) => {
      expect(finSub(d)).toBe(100 - oldDebtAdj(d));
    }
  );

  it("상수 값 자체 — 150 · 200 · +10 · +20 (판정표 '150% 이하'와 같은 숫자)", () => {
    expect(BUILDER_DEBT_TIERS.map((t) => [t.max, t.score])).toEqual([
      [150, 0],
      [200, 10],
    ]);
    expect(BUILDER_DEBT_HIGH_ADJ).toBe(20);
    expect(BUILDER_DEBT_UNKNOWN_ADJ).toBe(10);
  });
});

describe("계약해제율 판정 글자(CANCEL_RATIO_TIERS.label) ↔ 판정표(subContext) — 같은 경계", () => {
  // 분양 탭 계약해제율 눈금의 판정 글자는 tier label 에서, 점수 탭 문구는 subContext 가 안전점수 70/40 으로 가른다.
  // 두 자리가 다른 말을 하지 않게 칸마다 맞댄다(안전점수 = 100 − 위험 score).
  const WORD: Record<string, string> = { 적음: "계약 해제 적음", 보통: "해제율 보통", 많음: "계약 해제 주의" };
  const interpretCancel = (safety: number) => {
    const fn = SUB_CONTEXT.risk.계약해제율.interpret;
    if (!fn) throw new Error("subContext 계약해제율 interpret 가 없다");
    return fn(safety, "");
  };
  it.each(CANCEL_RATIO_TIERS.map((t) => [t.max, t.score, t.label] as const))(
    "≤%s%% (위험 %s) → '%s'",
    (_max, score, label) => {
      expect(interpretCancel(100 - score)).toBe(WORD[label as string]);
    }
  );
  it("마지막 칸 위(위험 최고점)도 '많음' ↔ '계약 해제 주의'", () => {
    expect(CANCEL_RATIO_HIGH_LABEL).toBe("많음");
    expect(interpretCancel(100 - CANCEL_RATIO_HIGH_SCORE)).toBe(WORD[CANCEL_RATIO_HIGH_LABEL]);
  });
  it("판정 글자 리터럴 — 적음 · 적음 · 보통 · 많음", () => {
    expect(CANCEL_RATIO_TIERS.map((t) => t.label)).toEqual(["적음", "적음", "보통", "많음"]);
  });
});

describe("인구 증감 경계 상수 옮기기 — 점수 변화 0", () => {
  const points: (number | null)[] = [null, -5, 3];
  for (const b of [1.0, 0.5, 0, -0.3, -0.8, -2.0]) points.push(b - 0.01, b, b + 0.01);
  it.each(points)("인구 증감 %s 에서 옛 식과 같은 점수", (p) => {
    expect(popSub(p)).toBe(oldPopScore(p));
  });

  it("상수 값 자체 — 1.0/95 · 0.5/80 · 0/65 · -0.3/50 · -0.8/35 · -2.0/20 · 그 아래 10", () => {
    expect(POP_GROWTH_TIERS.map((t) => [t.min, t.score])).toEqual([
      [1.0, 95],
      [0.5, 80],
      [0, 65],
      [-0.3, 50],
      [-0.8, 35],
      [-2.0, 20],
    ]);
    expect(POP_GROWTH_LOW_SCORE).toBe(10);
  });
});
