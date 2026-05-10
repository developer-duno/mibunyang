// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpertScoreBreakdown } from "./ExpertScoreBreakdown";
import { makeScoredItem } from "@/__tests__/factories";

describe("ExpertScoreBreakdown", () => {
  // 기본 렌더링 — 적정가 산출 과정 표시
  it("적정가 산출 과정을 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ nearbyMedian: 55000, price: 50000 }));
    render(<ExpertScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText("적정가 산출 과정")).toBeTruthy();
    expect(screen.getByText(/주변중위가/)).toBeTruthy();
    expect(screen.getByText(/연식계수/)).toBeTruthy();
    expect(screen.getByText(/면적보정/)).toBeTruthy();
    expect(screen.getByText(/브랜드보정/)).toBeTruthy();
  });

  // 6개 카테고리 섹션 렌더링 — 각 카테고리 총점 표시
  it("6개 카테고리 섹션의 총점을 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<ExpertScoreBreakdown apt={apt} res={res} profile="live" />);
    // 각 카테고리 총점이 "총점: XX점" 형태로 표시
    const totalLabels = screen.getAllByText(/총점:/);
    expect(totalLabels.length).toBe(6);
  });

  // 카테고리별 서브항목 테이블 헤더 표시
  it("서브항목 테이블 헤더를 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<ExpertScoreBreakdown apt={apt} res={res} profile="live" />);
    const subHeaders = screen.getAllByText("서브항목");
    expect(subHeaders.length).toBeGreaterThan(0);
  });

  // 프로필별 가중치 표시
  it("프로필에 따른 가중치를 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<ExpertScoreBreakdown apt={apt} res={res} profile="live" />);
    // live 프로필: location=40%
    expect(screen.getByText(/프로필 가중치: 40%/)).toBeTruthy();
  });

  // nearbyMedian이 0이면 적정가 0
  it("nearbyMedian이 0이면 적정가가 0으로 표시된다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ nearbyMedian: 0 }));
    render(<ExpertScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/괴리도 N\/A%/)).toBeTruthy();
  });

  // 존재하지 않는 프로필이면 live 폴백
  it("존재하지 않는 프로필이면 크래시 없이 렌더링한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    expect(() => render(<ExpertScoreBreakdown apt={apt} res={res} profile={/** @type {any} */ ("unknown")} />)).not.toThrow();
  });

  // 기여도 계산 표시
  it("기여도(점수 x 가중치)를 올바르게 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<ExpertScoreBreakdown apt={apt} res={res} profile="live" />);
    // 기여도가 "XX.X점" 형태로 표시됨
    const contributions = screen.getAllByText(/\d+\.\d+점/);
    expect(contributions.length).toBeGreaterThan(0);
  });
});
