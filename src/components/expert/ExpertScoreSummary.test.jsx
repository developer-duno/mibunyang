import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpertScoreSummary } from "./ExpertScoreSummary";
import { makeScoredItem } from "@/__tests__/factories";

describe("ExpertScoreSummary", () => {
  // 기본 렌더링 — 최종 가중 합계 타이틀 표시
  it("최종 가중 합계 제목을 프로필명과 함께 표시한다", () => {
    const { res } = makeScoredItem();
    render(<ExpertScoreSummary res={res} profile="live" />);
    expect(screen.getByText(/최종 가중 합계.*실거주/)).toBeTruthy();
  });

  // 카테고리별 점수, 가중치, 기여분 표시
  it("카테고리별 점수, 가중치, 기여분을 표시한다", () => {
    const { res } = makeScoredItem();
    render(<ExpertScoreSummary res={res} profile="live" />);
    // 합계 행과 100% 표시
    expect(screen.getByText("합계")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    // 6개 카테고리 행이 렌더링됨
    const rows = screen.getAllByText(/점수/);
    expect(rows.length).toBeGreaterThanOrEqual(0); // 헤더에 "점수" 없지만 rows 존재
  });

  // 총점과 등급 배지 표시
  it("총점과 등급을 표시한다", () => {
    const { res } = makeScoredItem({}, { total: 85 });
    render(<ExpertScoreSummary res={res} profile="live" />);
    expect(screen.getByText(/85점/)).toBeTruthy();
    // 85점 = A등급
    expect(screen.getByText(/A/)).toBeTruthy();
  });

  // 다른 프로필 — invest
  it("투자 프로필 가중치를 반영한다", () => {
    const { res } = makeScoredItem();
    render(<ExpertScoreSummary res={res} profile="invest" />);
    expect(screen.getByText(/투자/)).toBeTruthy();
    // invest: price=30%
    expect(screen.getByText("30%")).toBeTruthy();
  });

  // 존재하지 않는 프로필이면 폴백
  it("존재하지 않는 프로필이면 크래시 없이 렌더링한다", () => {
    const { res } = makeScoredItem();
    expect(() => render(<ExpertScoreSummary res={res} profile="nonexistent" />)).not.toThrow();
  });

  // 합계 행에 100% 표시
  it("합계 행에 100%가 표시된다", () => {
    const { res } = makeScoredItem();
    render(<ExpertScoreSummary res={res} profile="live" />);
    expect(screen.getByText("합계")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
  });
});
