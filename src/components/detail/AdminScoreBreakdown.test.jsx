// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminScoreBreakdown } from "./AdminScoreBreakdown";
import { makeScoredItem } from "@/__tests__/factories";

// 세션 405: 구 ExpertScoreBreakdown.test + ExpertScoreSummary.test 단언 이식 (전문가 대시보드 폐지·관리자 이식)

describe("AdminScoreBreakdown", () => {
  // ── 구 ExpertScoreBreakdown 단언 ──
  it("적정가 산출 과정을 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ nearbyMedian: 55000, price: 50000 }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText("적정가 산출 과정")).toBeTruthy();
    expect(screen.getByText(/주변중위가/)).toBeTruthy();
    expect(screen.getByText(/연식계수/)).toBeTruthy();
    expect(screen.getByText(/면적보정/)).toBeTruthy();
    expect(screen.getByText(/브랜드보정/)).toBeTruthy();
  });

  it("6개 카테고리 섹션의 총점을 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const totalLabels = screen.getAllByText(/총점:/);
    expect(totalLabels.length).toBe(6);
  });

  it("서브항목 테이블 헤더를 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const subHeaders = screen.getAllByText("서브항목");
    expect(subHeaders.length).toBeGreaterThan(0);
  });

  it("프로필에 따른 가중치를 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    // live 프로필: location=40%
    expect(screen.getByText(/프로필 가중치: 40%/)).toBeTruthy();
  });

  it("nearbyMedian이 0이면 괴리도 N/A로 표시된다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ nearbyMedian: 0 }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/괴리도 N\/A%/)).toBeTruthy();
  });

  it("존재하지 않는 프로필이면 크래시 없이 렌더링한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    expect(() => render(<AdminScoreBreakdown apt={apt} res={res} profile={/** @type {any} */ ("unknown")} />)).not.toThrow();
  });

  it("기여도(점수 x 가중치)를 올바르게 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const contributions = screen.getAllByText(/\d+\.\d+점/);
    expect(contributions.length).toBeGreaterThan(0);
  });

  // ── 구 ExpertScoreSummary 단언 ──
  it("최종 가중 합계 제목을 프로필명과 함께 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/최종 가중 합계.*실거주/)).toBeTruthy();
  });

  it("합계 행에 100%가 표시된다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText("합계")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("총점과 등급을 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({}, { total: 85 }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    // 합본 컴포넌트라 카테고리 총점 표("총점: 85점")와 합계 행("85점 (A)")이 공존 가능 — 복수 허용
    expect(screen.getAllByText(/85점/).length).toBeGreaterThanOrEqual(1);
  });

  it("투자 프로필 가중치를 반영한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="invest" />);
    expect(screen.getByText(/투자/)).toBeTruthy();
  });

  // ── 세션 405 신규: 도시등급(구 ExpertAptHeader) + 인쇄 + profile 기본값 ──
  it("도시등급을 표시한다 (구 전문가 헤더 이식)", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/도시등급:/)).toBeTruthy();
  });

  it("인쇄 버튼이 렌더링된다 (data-no-print)", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const printBtn = screen.getByRole("button", { name: "분석 결과 인쇄" });
    expect(printBtn).toBeTruthy();
    expect(printBtn.getAttribute("data-no-print")).not.toBeNull();
  });

  it("profile 미전달 시 live 폴백으로 렌더링한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} />);
    expect(screen.getByText(/최종 가중 합계.*실거주/)).toBeTruthy();
  });
});
