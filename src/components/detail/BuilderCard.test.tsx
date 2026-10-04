import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuilderCard, DEBT_GAUGE, debtColor } from "./BuilderCard";
import { BUILDER_DEBT_TIERS } from "@/constants/scoringTiers";
import { C } from "@/theme";
import { makeApt } from "@/__tests__/factories";
import type { Apt } from "@/types/scoring";

// factories.js 는 plain .js(타입 미검사)라 makeApt() 반환값이 Apt 와 구조적으로 어긋난다.
// .tsx 파일은 JSDoc `@type` 캐스트를 적용 안 해서(그건 @ts-check .js 전용) 명시 캐스트한다.
function apt(overrides: Record<string, unknown> = {}): Apt {
  return makeApt(overrides) as unknown as Apt;
}

/** 렌더된 부채비율 눈금 점의 위치(style left %) — 인자 순서가 뒤집히면 순수 함수 시험은 초록이라 화면으로 본다 */
function dotLeft(d: number): number {
  const { container, unmount } = render(<BuilderCard apt={apt({ builderDebtRatio: d })} />);
  const g = container.querySelector(`[data-testid="debt-gauge"][data-debt="${d}"]`);
  const dot = [...(g?.querySelectorAll<HTMLElement>("div") ?? [])].find((x) => x.style.borderRadius === "50%");
  const pct = parseFloat(dot?.style.left ?? "NaN");
  unmount();
  return pct;
}

describe("BuilderCard — 게이트 · 접힘 없음 (세션591 P2)", () => {
  it("3필드가 전부 null 이면 렌더하지 않는다", () => {
    const { container } = render(
      <BuilderCard apt={apt({ builder: null, builderCreditGrade: null, builderDebtRatio: null })} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("펼치기 버튼 없이 이름 칩과 부채비율 눈금이 바로 보인다 (옛 '시공사 정보' 접힘 삭제)", () => {
    render(<BuilderCard apt={apt({ builder: "롯데건설", builderCreditGrade: "BBB", builderDebtRatio: 168.2 })} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("시공사 정보")).toBeNull();
    expect(screen.getByText("시공사")).toBeTruthy();
    expect(screen.getByText("롯데건설 (1군)")).toBeTruthy();
    expect(screen.getByTestId("debt-gauge")).toBeTruthy();
  });

  it("부채비율만 없으면 눈금 없이 이름 칩만", () => {
    render(<BuilderCard apt={apt({ builder: "현대건설", builderCreditGrade: "AA", builderDebtRatio: null })} />);
    expect(screen.getByText("현대건설 (1군Super)")).toBeTruthy();
    expect(screen.queryByTestId("debt-gauge")).toBeNull();
  });

  it("시공사 이름 없이 부채비율만 있으면 눈금만 (이름 칩 없음)", () => {
    const { container } = render(
      <BuilderCard apt={apt({ builder: null, builderCreditGrade: null, builderDebtRatio: 120 })} />
    );
    expect(container.querySelector('[data-chip="builder"]')).toBeNull();
    expect(screen.getByTestId("debt-gauge")).toBeTruthy();
  });
});

// 보완 G3(세션591 사장님 결정) — 이 칸의 값은 신용평가사 등급이 아니라 부채비율로 계산한 값이라
//   (dart-builders.mjs estimateCreditGrade · 정적 사본 400/400 일치) 칩을 뺐다. 부채비율 눈금이 같은 내용을 말한다.
describe("BuilderCard — 신용등급 칩 없음 (보완 G3)", () => {
  it("등급이 있어도 신용등급 칩을 그리지 않는다", () => {
    const { container } = render(
      <BuilderCard apt={apt({ builder: "롯데건설", builderCreditGrade: "BBB", builderDebtRatio: 168.2 })} />
    );
    expect(container.querySelector('[data-chip="builderCreditGrade"]')).toBeNull();
    expect(screen.queryByText(/신용/)).toBeNull();
    expect(screen.queryByText("BBB")).toBeNull();
  });

  it("등급만 있고 이름·부채비율이 없으면 블록을 안 그린다 (제목만 남는 빈 블록 금지)", () => {
    const { container } = render(
      <BuilderCard apt={apt({ builder: null, builderCreditGrade: "AA", builderDebtRatio: null })} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("등급만 있고 부채비율이 대체값(폴백)이어도 그릴 것이 없으니 블록을 안 그린다", () => {
    const { container } = render(
      <BuilderCard
        apt={apt({ builder: null, builderCreditGrade: "A", builderDebtRatio: 250, _fallbackBuilderDebt: true })}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("BuilderCard — 칩 글자는 FIELD_META fmt 재사용 (등급 어휘를 새로 짓지 않는다)", () => {
  it("등급표에 없는 시공사는 '(기타)'", () => {
    render(<BuilderCard apt={apt({ builder: "어느건설", builderCreditGrade: null })} />);
    expect(screen.getByText("어느건설 (기타)")).toBeTruthy();
  });

  it("신탁·조합 시행 주체는 '(브랜드 해당없음)' — 신용등급 칩은 없다", () => {
    render(<BuilderCard apt={apt({ builder: "OO자산신탁", builderCreditGrade: null })} />);
    expect(screen.getByText("OO자산신탁 (브랜드 해당없음)")).toBeTruthy();
    expect(screen.queryByText(/신용등급/)).toBeNull();
  });
});

describe("BuilderCard — 부채비율 눈금 (기준선 BUILDER_DEBT_TIERS)", () => {
  it("눈금 세 점은 점수표 경계에서 읽는다 — 가운데 150 · 불리한 끝 200 · 유리한 끝 100", () => {
    expect(DEBT_GAUGE).toEqual({ center: 150, worst: 200, best: 100 });
    expect(DEBT_GAUGE.center).toBe(BUILDER_DEBT_TIERS[0].max);
    expect(DEBT_GAUGE.worst).toBe(BUILDER_DEBT_TIERS[1].max);
  });

  // 보완 F2 — 가운데 눈금(150) 바로 밑에 실제 값을 찍으면 "150 자리에 168"로 읽힌다. 값은 제목, 가운데는 기준.
  it("실제 값은 제목('부채비율 168.2%'), 가운데 글자는 '기준 150%'", () => {
    render(<BuilderCard apt={apt({ builderDebtRatio: 168.2 })} />);
    expect(screen.getByText("부채비율 168.2%")).toBeTruthy();
    expect(screen.getByText("기준 150%")).toBeTruthy();
    expect(screen.queryByText(/168\.2% \(기준/)).toBeNull();
    expect(screen.getByText("높음 200%")).toBeTruthy();
    expect(screen.getByText("낮음 100%")).toBeTruthy();
  });

  it("렌더된 점 위치 — 오른쪽 = 유리(부채 적음): 150 가운데 · 100↓ 오른쪽 끝 · 200↑ 왼쪽 끝", () => {
    expect(dotLeft(150)).toBe(50);
    expect(dotLeft(100)).toBe(100);
    expect(dotLeft(49.9)).toBe(100);
    expect(dotLeft(200)).toBe(0);
    expect(dotLeft(168.2)).toBeLessThan(50); // 기준보다 부채가 많다 → 왼쪽
    expect(dotLeft(120)).toBeGreaterThan(50);
  });

  it("끝을 넘는 값은 끝점에 고정하고 제목은 실제 값 그대로 — '부채비율 551.1%'", () => {
    expect(dotLeft(551.1)).toBe(0);
    render(<BuilderCard apt={apt({ builderDebtRatio: 551.1 })} />);
    expect(screen.getByText("부채비율 551.1%")).toBeTruthy();
  });

  it("색 — ≤150 초록 · ≤200 주황 · 그 위 빨강 (같은 경계)", () => {
    expect(debtColor(150)).toBe(C.green);
    expect(debtColor(150.1)).toBe(C.amber);
    expect(debtColor(200)).toBe(C.amber);
    expect(debtColor(200.1)).toBe(C.red);
  });

  it("값이 있어도 _fallbackBuilderDebt 면 눈금을 안 그린다 (지역 평균 대체값을 이 시공사 값처럼 말하지 않는다, #368)", () => {
    render(<BuilderCard apt={apt({ builderDebtRatio: 250, _fallbackBuilderDebt: true })} />);
    expect(screen.queryByTestId("debt-gauge")).toBeNull();
    expect(screen.queryByText(/250%/)).toBeNull();
  });

  it("aria·글자에 '점수' 낱말이 없다", () => {
    const { container } = render(<BuilderCard apt={apt({ builderDebtRatio: 168.2 })} />);
    expect(container.textContent).not.toContain("점수");
  });
});

describe("BuilderCard — hugGuarantee 제외 (사장님 확정, Q6 유지)", () => {
  it("HUG 보증 필드는 그리지 않는다", () => {
    render(<BuilderCard apt={apt({ hugGuarantee: true })} />);
    expect(screen.queryByText(/HUG/)).toBeNull();
  });
});
