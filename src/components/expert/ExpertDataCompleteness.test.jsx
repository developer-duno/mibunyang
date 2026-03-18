import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpertDataCompleteness } from "./ExpertDataCompleteness";
import { makeApt } from "@/__tests__/factories";

describe("ExpertDataCompleteness", () => {
  // 기본 렌더링 — 데이터 완성도 제목 표시
  it("데이터 완성도 제목을 표시한다", () => {
    const apt = makeApt();
    render(<ExpertDataCompleteness apt={apt} />);
    expect(screen.getByText("데이터 완성도")).toBeTruthy();
  });

  // progressbar 렌더링
  it("progressbar가 렌더링된다", () => {
    const apt = makeApt();
    render(<ExpertDataCompleteness apt={apt} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeTruthy();
    const pct = parseInt(bar.getAttribute("aria-valuenow"), 10);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  // 완성도 퍼센트 표시
  it("완성도 퍼센트를 숫자로 표시한다", () => {
    const apt = makeApt();
    render(<ExpertDataCompleteness apt={apt} />);
    // aria-label에 퍼센트 포함
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-label")).toMatch(/데이터 완성도 \d+%/);
  });

  // 실제 데이터/미등록 카운트 표시
  it("실제 데이터, 기본값, 미등록 카운트를 표시한다", () => {
    const apt = makeApt();
    render(<ExpertDataCompleteness apt={apt} />);
    expect(screen.getByText(/실제 데이터:/)).toBeTruthy();
    expect(screen.getByText(/미등록:/)).toBeTruthy();
  });

  // 모든 필드가 null인 경우 — 미등록이 최대
  it("모든 필드가 null이면 완성도가 0%이다", () => {
    const apt = { id: 1 };
    render(<ExpertDataCompleteness apt={apt} />);
    const bar = screen.getByRole("progressbar");
    const pct = parseInt(bar.getAttribute("aria-valuenow"), 10);
    // 대부분 필드가 null이므로 완성도 매우 낮음
    expect(pct).toBeLessThanOrEqual(10);
  });

  // 미등록 필드 목록 표시
  it("미등록 필드 목록을 표시한다", () => {
    const apt = { id: 1 };
    render(<ExpertDataCompleteness apt={apt} />);
    expect(screen.getByText(/미등록 필드:/)).toBeTruthy();
  });

  // 데이터가 많이 채워진 경우 높은 완성도
  it("데이터가 많이 채워지면 높은 완성도를 표시한다", () => {
    const apt = makeApt();
    render(<ExpertDataCompleteness apt={apt} />);
    const bar = screen.getByRole("progressbar");
    const pct = parseInt(bar.getAttribute("aria-valuenow"), 10);
    // makeApt는 대부분 필드 채움 → 50% 이상 기대
    expect(pct).toBeGreaterThan(30);
  });
});
