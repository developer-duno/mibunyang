// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminUnitSupply } from "./AdminUnitSupply";
import { makeApt } from "@/__tests__/factories";

// 세션 405: 구 ExpertUnitPlaceholder.test 단언 이식 (전문가 대시보드 폐지·관리자 이식)

describe("AdminUnitSupply", () => {
  it("동/호수 현황 제목을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 1000, unsold: 150, unsoldRate: 15 }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText(/동\/호수 현황/)).toBeTruthy();
  });

  it("총 세대, 미분양, 미분양률을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 1000, unsold: 150, unsoldRate: 15 }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("총 세대")).toBeTruthy();
    expect(screen.getByText("1,000")).toBeTruthy();
    expect(screen.getByText("미분양")).toBeTruthy();
    expect(screen.getByText("150")).toBeTruthy();
    expect(screen.getByText("미분양률")).toBeTruthy();
    expect(screen.getByText("15.0%")).toBeTruthy();
  });

  it("units가 null이면 0을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: null, unsold: null, unsoldRate: null }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("unsold가 null이면 '—'을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 500, unsold: null, unsoldRate: null }));
    render(<AdminUnitSupply apt={apt} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("unsoldRate가 null이고 units > 0이면 unsold/units로 계산한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 200, unsold: 30, unsoldRate: null }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("15.0%")).toBeTruthy();
  });

  it("평형별 데이터 미보유 시 미등록 안내와 예시를 표시한다 (빈 상태)", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("동/호수 상세 데이터 미등록")).toBeTruthy();
    expect(screen.getByText(/향후 관리자 페이지에서/)).toBeTruthy();
    expect(screen.getByText(/예시: 101동 1201호/)).toBeTruthy();
  });

  it("unsoldRate가 있으면 그 값을 직접 사용한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 500, unsold: 100, unsoldRate: 20 }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("20.0%")).toBeTruthy();
  });
});
