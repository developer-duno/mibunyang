// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpertUnitPlaceholder } from "./ExpertUnitPlaceholder";
import { makeApt } from "@/__tests__/factories";

describe("ExpertUnitPlaceholder", () => {
  // 기본 렌더링 — 동/호수 현황 제목 표시
  it("동/호수 현황 제목을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 1000, unsold: 150, unsoldRate: 15 }));
    render(<ExpertUnitPlaceholder apt={apt} />);
    expect(screen.getByText("동/호수 현황")).toBeTruthy();
  });

  // 총 세대, 미분양, 미분양률 표시
  it("총 세대, 미분양, 미분양률을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 1000, unsold: 150, unsoldRate: 15 }));
    render(<ExpertUnitPlaceholder apt={apt} />);
    expect(screen.getByText("총 세대")).toBeTruthy();
    expect(screen.getByText("1,000")).toBeTruthy();
    expect(screen.getByText("미분양")).toBeTruthy();
    expect(screen.getByText("150")).toBeTruthy();
    expect(screen.getByText("미분양률")).toBeTruthy();
    expect(screen.getByText("15.0%")).toBeTruthy();
  });

  // units가 null이면 0 표시
  it("units가 null이면 0을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: null, unsold: null, unsoldRate: null }));
    render(<ExpertUnitPlaceholder apt={apt} />);
    expect(screen.getByText("0")).toBeTruthy();
  });

  // unsold가 null이면 "—" 표시
  it("unsold가 null이면 '—'을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 500, unsold: null, unsoldRate: null }));
    render(<ExpertUnitPlaceholder apt={apt} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  // unsoldRate가 null이고 units > 0이면 직접 계산
  it("unsoldRate가 null이고 units > 0이면 unsold/units로 계산한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 200, unsold: 30, unsoldRate: null }));
    render(<ExpertUnitPlaceholder apt={apt} />);
    // 30/200 * 100 = 15.0%
    expect(screen.getByText("15.0%")).toBeTruthy();
  });

  // 플레이스홀더 안내 메시지 표시
  it("동/호수 상세 데이터 미등록 안내를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertUnitPlaceholder apt={apt} />);
    expect(screen.getByText("동/호수 상세 데이터 미등록")).toBeTruthy();
    expect(screen.getByText(/향후 관리자 페이지에서/)).toBeTruthy();
  });

  // 예시 텍스트 표시
  it("예시 텍스트를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertUnitPlaceholder apt={apt} />);
    expect(screen.getByText(/예시: 101동 1201호/)).toBeTruthy();
  });

  // unsoldRate가 있으면 그 값 직접 사용
  it("unsoldRate가 있으면 그 값을 직접 사용한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 500, unsold: 100, unsoldRate: 20 }));
    render(<ExpertUnitPlaceholder apt={apt} />);
    // unsoldRate=20 → "20.0%"
    expect(screen.getByText("20.0%")).toBeTruthy();
  });
});
