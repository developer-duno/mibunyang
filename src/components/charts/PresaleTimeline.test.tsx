import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresaleTimeline, logPos, fmtRate, STAGES } from "./PresaleTimeline";

describe("logPos — 자릿수 눈금이 작은 값을 살려낸다", () => {
  it("1 이하는 0 (막대 없음)", () => {
    expect(logPos(0)).toBe(0);
    expect(logPos(1)).toBe(0);
    expect(logPos(-5)).toBe(0);
  });

  it("자릿수마다 같은 간격으로 늘어난다", () => {
    const p10 = logPos(10);
    const p100 = logPos(100);
    const p1000 = logPos(1000);
    expect(p100 - p10).toBeCloseTo(p1000 - p100, 6);
  });

  it("★ 최대치(437,995)가 있어도 중앙값(10.62)이 안 눌린다", () => {
    // 선형이면 10.62/437995 = 0.0024% → 폭 0. 로그면 눈에 보이는 폭이 남는다.
    const linear = 10.62 / 437995; // 선형 막대였다면 이 비율이 폭이 된다
    expect(linear).toBeLessThan(0.0001); // = 화면에서 사실상 0
    expect(logPos(10.62), "로그 눈금에서는 눈에 보이는 폭이 남아야 한다").toBeGreaterThan(0.15);
  });

  it("눈금 밖(1000만 대 1)도 1을 안 넘는다", () => {
    expect(logPos(1e9)).toBe(1);
  });
});

describe("fmtRate", () => {
  it("10 이상은 정수 + 천단위 쉼표", () => {
    expect(fmtRate(437995)).toBe("437,995");
    expect(fmtRate(10.62)).toBe("11");
  });
  it("10 미만은 소수 둘째까지 (0.01 같은 값이 0 으로 죽지 않게)", () => {
    expect(fmtRate(0.01)).toBe("0.01");
    expect(fmtRate(1.5)).toBe("1.5");
  });
});

describe("PresaleTimeline — 분양 정보 없는 절반은 안 그린다", () => {
  it("단계가 없으면 이유를 적고 그림을 안 그린다", () => {
    render(<PresaleTimeline stage={null} />);
    expect(screen.getByText(/분양 정보를 아직 모으지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("모르는 단계 이름이면 안 그린다 (없는 칸을 칠하지 않는다)", () => {
    render(<PresaleTimeline stage="알수없는단계" />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("PresaleTimeline — 단계 표시", () => {
  it.each(STAGES)("%s 단계면 네 칸 모두 이름이 보이고 현재 단계 설명이 붙는다", (stage) => {
    render(<PresaleTimeline stage={stage} />);
    for (const s of STAGES) expect(screen.getByText(s)).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("스크린리더에 몇 번째 단계인지 말해준다", () => {
    render(<PresaleTimeline stage="분양중" />);
    const label = screen.getByRole("img").getAttribute("aria-label") || "";
    expect(label).toContain("4칸 중 3번째");
    expect(label).not.toContain("점수");
  });
});

describe("PresaleTimeline — 분양가 범위", () => {
  it("min<max 일 때만 범위 막대를 그린다", () => {
    render(<PresaleTimeline stage="분양중" minPrice={30000} maxPrice={70000} />);
    expect(screen.getByText("분양가 범위")).toBeInTheDocument();
    expect(screen.getByText("30,000만")).toBeInTheDocument();
  });

  it("min==max 면 범위가 아니라 안 그린다 (폭 0 막대는 거짓말)", () => {
    render(<PresaleTimeline stage="분양중" minPrice={50000} maxPrice={50000} />);
    expect(screen.queryByText("분양가 범위")).toBeNull();
  });

  it("이 평형 분양가가 범위 밖이면 표시선을 안 긋는다", () => {
    render(<PresaleTimeline stage="분양중" minPrice={30000} maxPrice={70000} aptPrice={90000} />);
    expect(screen.queryByText(/이 평형 분양가/)).toBeNull();
  });

  it("범위 안이면 표시선과 금액을 보여준다", () => {
    render(<PresaleTimeline stage="분양중" minPrice={30000} maxPrice={70000} aptPrice={50000} />);
    expect(screen.getByText(/이 평형 분양가 50,000만/)).toBeInTheDocument();
  });
});

describe("PresaleTimeline — 경쟁률", () => {
  it("0 이하면 경쟁률 줄을 안 그린다", () => {
    render(<PresaleTimeline stage="분양중" competitionRate={0} />);
    expect(screen.queryByText(/청약 경쟁률/)).toBeNull();
  });

  it("값이 있으면 자릿수 눈금과 함께 보여준다", () => {
    render(<PresaleTimeline stage="분양중" competitionRate={437995} />);
    expect(screen.getByText(/437,995 : 1/)).toBeInTheDocument();
    expect(screen.getByText("100만")).toBeInTheDocument(); // 눈금 끝
  });
});
