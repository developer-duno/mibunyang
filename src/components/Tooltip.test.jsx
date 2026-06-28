// @ts-check
// Tooltip 단위 테스트 — 용어 풀이 + 접근성 (spec § 5-3)
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tooltip, TERM_GLOSSARY, extractTerm } from "./Tooltip";

describe("extractTerm — 자유 형식 텍스트에서 사전 키 추출", () => {
  it("'민영주택' → '민영'", () => {
    expect(extractTerm("민영주택")).toBe("민영");
  });

  it("'도시형 생활주택' → '도시형'", () => {
    expect(extractTerm("도시형 생활주택")).toBe("도시형");
  });

  it("'공공분양' → '공공'", () => {
    expect(extractTerm("공공분양")).toBe("공공");
  });

  it("'주상복합' 그대로 → '주상복합'", () => {
    expect(extractTerm("주상복합")).toBe("주상복합");
  });

  it("사전 미등록 텍스트 → null", () => {
    expect(extractTerm("타운하우스")).toBeNull();
  });

  it("null/빈 문자열/숫자 → null", () => {
    expect(extractTerm(null)).toBeNull();
    expect(extractTerm("")).toBeNull();
    expect(extractTerm(123)).toBeNull();
  });
});

describe("Tooltip — 표시 + 접근성", () => {
  it("term 이 사전에 있으면 trigger 가 dashed underline 으로 렌더", () => {
    render(
      <Tooltip term="민영">
        <span data-testid="trigger">민영주택</span>
      </Tooltip>
    );
    expect(screen.getByTestId("trigger")).toBeDefined();
    // 초기 상태에서는 tooltip role 미노출
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("term 이 사전에 없으면 children 그대로 통과 (Tooltip 래핑 X)", () => {
    const { container } = render(
      <Tooltip term="알 수 없는 용어">
        <span>알 수 없음</span>
      </Tooltip>
    );
    // 사전 미등록 → children 만 노출, tooltip ARIA 없음
    expect(container.querySelector('[role="button"]')).toBeNull();
  });

  it("hover 시 tooltip 노출 (mouseEnter)", () => {
    render(
      <Tooltip term="1순위">
        <span>1순위</span>
      </Tooltip>
    );
    const trigger = screen.getByRole("button");
    fireEvent.mouseEnter(trigger);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("청약통장");
  });

  it("focus 시 tooltip 노출", () => {
    render(
      <Tooltip term="특별공급">
        <span>특별공급</span>
      </Tooltip>
    );
    const trigger = screen.getByRole("button");
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip").textContent).toContain("신혼");
  });

  it("Enter 키 → toggle (tap=toggle 동작)", () => {
    render(
      <Tooltip term="민영">
        <span>민영</span>
      </Tooltip>
    );
    const trigger = screen.getByRole("button");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("tooltip")).toBeDefined();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("Escape 키 → tooltip 닫기", () => {
    render(
      <Tooltip term="민영">
        <span>민영</span>
      </Tooltip>
    );
    const trigger = screen.getByRole("button");
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeDefined();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("aria-describedby 는 열린 상태에서만 부여", () => {
    render(
      <Tooltip term="민영">
        <span>민영</span>
      </Tooltip>
    );
    const trigger = screen.getByRole("button");
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    fireEvent.mouseEnter(trigger);
    expect(trigger.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("definition prop 우선 (사전 미등록도 직접 풀이 전달 가능)", () => {
    render(
      <Tooltip term="알수없음" definition="직접 정의">
        <span>커스텀</span>
      </Tooltip>
    );
    const trigger = screen.getByRole("button");
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe("직접 정의");
  });
});

describe("TERM_GLOSSARY — 청약 표준 용어 사전 (spec § 5-3 + § 6-3)", () => {
  it("핵심 9용어가 모두 등록되어 있다", () => {
    const required = ["민영", "공공", "국민", "1순위", "2순위", "특별공급", "도시형", "오피스텔", "주상복합"];
    for (const k of required) {
      expect(TERM_GLOSSARY[k]).toBeDefined();
      expect(TERM_GLOSSARY[k].length).toBeGreaterThan(5);
    }
  });
});
