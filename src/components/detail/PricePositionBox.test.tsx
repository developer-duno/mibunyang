import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PricePositionBox } from "./PricePositionBox";
import { PSR_FULL_AT, PSR_ZERO_AT } from "@/constants/scoringTiers";
import type { Apt } from "@/types/scoring";

/**
 * 시세 탭 맨 위 상자 — 적정가 줄 + PSR 줄 (세션589).
 *
 * 적정가 줄의 눈금·색·게이트는 `DetailModal.test.jsx` "적정가 대비 위치 게이지" 묶음이 모달 경유로 지킨다
 * (떼어내기 전부터 있던 시험 — 한 줄도 안 고쳤다). 여기는 **PSR 줄**과 두 줄의 조합을 본다.
 *
 * ⚠️ 기대값(70%·120%·85%·100%)은 **리터럴**로 적는다 — 상수에서 읽어 비교하면 상수가 바뀔 때
 *    같이 따라가 아무것도 못 잡는다(.claude/rules/meta/guards-must-be-mutation-tested.md "파생 가드").
 */

const GREEN = "rgb(22, 163, 74)";
const RED = "rgb(220, 38, 38)";
const MUTED = "rgb(107, 114, 128)";

const apt = (over: Record<string, unknown> = {}) => ({ id: "t", name: "t", ...over }) as unknown as Apt;
const PRICE = { fairPrice: 48000, deviation: "5.0" };

/** PSR 줄의 점 */
const psrDot = () =>
  screen.getByTestId("psr-gauge").querySelector<HTMLElement>('[style*="width: 14px"][style*="border-radius: 50%"]');

describe("PricePositionBox — PSR 줄", () => {
  it("값을 % 로 적는다 — 0.38 → '구 실거래가의 38%'", () => {
    render(<PricePositionBox priceCat={PRICE} apt={apt({ psr: 0.38 })} />);
    const g = screen.getByTestId("psr-gauge");
    expect(g.textContent).toContain("구 실거래가 대비 분양가(㎡당)");
    expect(g.textContent).toContain("구 실거래가의 38%");
    expect(g.textContent).not.toContain("0.38");
  });

  it("양 끝 글자 = 점수가 만점·0점이 되는 지점 (70% · 120%)", () => {
    render(<PricePositionBox priceCat={PRICE} apt={apt({ psr: 0.9 })} />);
    const g = screen.getByTestId("psr-gauge");
    expect(g.textContent).toContain("120% 이상");
    expect(g.textContent).toContain("70% 이하");
    // 상수가 그 값이라는 것도 리터럴로 못 박는다
    expect(PSR_FULL_AT).toBeCloseTo(0.7, 10);
    expect(PSR_ZERO_AT).toBeCloseTo(1.2, 10);
  });

  it("100% 는 한가운데, 70% 는 오른쪽 끝, 120% 는 왼쪽 끝", () => {
    const at = (psr: number) => {
      const { unmount } = render(<PricePositionBox priceCat={PRICE} apt={apt({ psr })} />);
      const left = parseFloat(psrDot()?.style.left ?? "NaN");
      unmount();
      return left;
    };
    expect(at(1.0)).toBe(50);
    expect(at(0.7)).toBe(100);
    expect(at(1.2)).toBeCloseTo(0, 6);
    // 끝을 넘는 값은 끝에 고정 — 글자가 실제 값을 말한다
    expect(at(0.38)).toBe(100);
    expect(at(2.5)).toBe(0);
    // 안쪽 — 끝을 다른 값으로 바꾸면 red (양 끝만 재면 어떤 끝 값이든 포화해 통과한다)
    expect(at(0.85)).toBeCloseTo(75, 6);
    expect(at(1.1)).toBeCloseTo(25, 6);
  });

  it("색 3단 — 85% 미만 초록 / 85~100% 중립 / 100% 초과 빨강", () => {
    const color = (psr: number) => {
      const { unmount } = render(<PricePositionBox priceCat={PRICE} apt={apt({ psr })} />);
      const c = psrDot()?.style.background;
      unmount();
      return c;
    };
    expect(color(0.84)).toBe(GREEN);
    expect(color(0.85)).toBe(MUTED); // 경계는 중립 쪽
    expect(color(0.95)).toBe(MUTED);
    expect(color(1.0)).toBe(MUTED); // 100% 는 아직 중립
    expect(color(1.01)).toBe(RED);
  });

  it("가운데 글자도 점과 같은 색이다", () => {
    render(<PricePositionBox priceCat={PRICE} apt={apt({ psr: 0.38 })} />);
    expect(screen.getByText("구 실거래가의 38%").style.color).toBe(GREEN);
  });

  it("? 도움말이 무엇을 무엇으로 나눈 값인지 말한다", () => {
    render(<PricePositionBox priceCat={PRICE} apt={apt({ psr: 0.9 })} />);
    fireEvent.click(screen.getByRole("button", { name: "구 실거래가 대비 분양가(㎡당) 풀이 보기" }));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(/최근 12개월/);
    expect(tip).toHaveTextContent(/한가운데 값/);
  });

  it.each([null, undefined, Number.NaN, 0, -0.5, "0.9"])("psr 이 %p 면 PSR 줄을 안 그린다", (psr) => {
    render(<PricePositionBox priceCat={PRICE} apt={apt({ psr })} />);
    expect(screen.queryByTestId("psr-gauge")).toBeNull();
    // 적정가 줄은 그대로
    expect(screen.getByText("적정가 대비 위치")).toBeTruthy();
  });

  it("글자에 '점수' 가 없다 (값이지 점수가 아니다 — 비로그인에게도 공개)", () => {
    const { container } = render(<PricePositionBox priceCat={PRICE} apt={apt({ psr: 0.9 })} />);
    expect(container.textContent).not.toContain("점수");
  });
});

describe("PricePositionBox — 두 줄의 조합", () => {
  it("적정가가 없고(fairPrice=0) PSR 만 있으면 PSR 줄만 그린다 — 적정가 제목은 없다 (SC1)", () => {
    render(<PricePositionBox priceCat={{ fairPrice: 0, deviation: "0.0" }} apt={apt({ psr: 0.9 })} />);
    expect(screen.queryByText("적정가 대비 위치")).toBeNull();
    expect(screen.getByTestId("psr-gauge")).toBeTruthy();
  });

  it("둘 다 없으면 상자 자체를 안 그린다", () => {
    const { container } = render(<PricePositionBox priceCat={{ fairPrice: 0, deviation: "0.0" }} apt={apt()} />);
    expect(container.firstChild).toBeNull();
    const none = render(<PricePositionBox priceCat={undefined} apt={apt({ psr: null })} />);
    expect(none.container.firstChild).toBeNull();
  });

  it("괴리율이 숫자가 아니면 적정가 줄을 안 그린다", () => {
    render(<PricePositionBox priceCat={{ fairPrice: 48000, deviation: "abc" }} apt={apt({ psr: 0.9 })} />);
    expect(screen.queryByText("적정가 대비 위치")).toBeNull();
  });

  it("적정가 줄이 먼저, PSR 줄이 그 아래다", () => {
    const { container } = render(<PricePositionBox priceCat={PRICE} apt={apt({ psr: 0.9 })} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("적정가 대비 위치")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("적정가 대비 위치")).toBeLessThan(text.indexOf("구 실거래가 대비 분양가"));
  });
});
