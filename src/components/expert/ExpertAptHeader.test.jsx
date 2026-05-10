// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpertAptHeader } from "./ExpertAptHeader";
import { makeScoredItem } from "@/__tests__/factories";

describe("ExpertAptHeader", () => {
  // 기본 렌더링 — 아파트 이름, 지역 표시
  it("아파트 이름과 지역 정보를 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ name: "힐스테이트 수원", region: "경기", gu: "수원시", dong: "영통동" }));
    render(<ExpertAptHeader apt={apt} res={res} />);
    expect(screen.getByText("힐스테이트 수원")).toBeTruthy();
    expect(screen.getByText(/경기 수원시 영통동/)).toBeTruthy();
  });

  // dong이 null인 경우
  it("dong이 null이어도 크래시 없이 렌더링한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ dong: null }));
    expect(() => render(<ExpertAptHeader apt={apt} res={res} />)).not.toThrow();
  });

  // builder가 null인 경우
  it("builder가 null이어도 크래시 없이 렌더링한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ builder: null }));
    expect(() => render(<ExpertAptHeader apt={apt} res={res} />)).not.toThrow();
  });

  // area가 null인 경우
  it("area가 null이어도 크래시 없이 렌더링한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ area: null }));
    expect(() => render(<ExpertAptHeader apt={apt} res={res} />)).not.toThrow();
  });

  // completion이 null인 경우
  it("completion이 null이어도 크래시 없이 렌더링한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ completion: null }));
    expect(() => render(<ExpertAptHeader apt={apt} res={res} />)).not.toThrow();
  });

  // ScoreBadge가 총점을 표시
  it("ScoreBadge에 총점이 표시된다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({}, { total: 85 }));
    render(<ExpertAptHeader apt={apt} res={res} />);
    expect(screen.getByLabelText(/점수: 85점/)).toBeTruthy();
  });

  // Radar 차트가 렌더링
  it("레이더 차트가 렌더링된다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<ExpertAptHeader apt={apt} res={res} />);
    expect(screen.getByLabelText(/레이더 차트/)).toBeTruthy();
  });

  // 시공사 브랜드 티어 표시
  it("시공사 브랜드 티어를 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ builder: "현대건설" }));
    render(<ExpertAptHeader apt={apt} res={res} />);
    expect(screen.getByText(/현대건설.*1군Super/)).toBeTruthy();
  });

  // 도시등급 표시
  it("지역에 따른 도시등급을 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ region: "서울" }));
    render(<ExpertAptHeader apt={apt} res={res} />);
    expect(screen.getByText(/도시등급 특별시/)).toBeTruthy();
  });
});
