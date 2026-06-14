// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarketSummaryWidget } from "./MarketSummaryWidget";

const mk = (/** @type {string} */ id, /** @type {number | null} */ price, /** @type {number | null} */ unsoldRate) => /** @type {any} */ ({ apt: { id, name: `n${id}`, region: "경기", price, unsoldRate }, res: { total: 50, cats: {} } });

describe("MarketSummaryWidget", () => {
  it("단지 수·분양가 중위(억)·미분양률 중위(%) 집계", () => {
    const scored = [mk("1", 30000, 10), mk("2", 50000, 20), mk("3", 70000, 30)];
    render(<MarketSummaryWidget scored={scored} dataFreshnessText="오늘 06:00 업데이트" />);
    expect(screen.getByText("3개")).toBeInTheDocument();
    expect(screen.getByText("5.0억")).toBeInTheDocument();
    expect(screen.getByText("20.0%")).toBeInTheDocument();
    expect(screen.getByText("오늘 06:00 업데이트")).toBeInTheDocument();
  });
  it("price/unsoldRate null 단지는 해당 지표 분모에서 제외", () => {
    const scored = [mk("1", 30000, null), mk("2", null, 20)];
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
    expect(screen.getByText("3.0억")).toBeInTheDocument();
    expect(screen.getByText("20.0%")).toBeInTheDocument();
  });
  it("빈 scored: 값 자리 '—'", () => {
    render(<MarketSummaryWidget scored={[]} dataFreshnessText={null} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
  it("점수 파생 지표 미노출 (원시값 4종만 — 비로그인 공개 안전)", () => {
    render(<MarketSummaryWidget scored={[mk("1", 30000, 10)]} dataFreshnessText={null} />);
    expect(screen.queryByText(/평균 점수/)).toBeNull();
  });

  describe("칸별 클릭 동선 (onCellNav)", () => {
    const scored = [mk("1", 30000, 10), mk("2", 50000, 20)];

    it("전국 단지 칸 → 목록 (정렬 없음)", () => {
      const onCellNav = vi.fn();
      render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} onCellNav={onCellNav} />);
      fireEvent.click(screen.getByRole("button", { name: /전국 단지/ }));
      expect(onCellNav).toHaveBeenCalledWith("전국 단지", { target: "list" });
    });

    it("분양가 중위 칸 → 목록 + 저가순 정렬", () => {
      const onCellNav = vi.fn();
      render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} onCellNav={onCellNav} />);
      fireEvent.click(screen.getByRole("button", { name: /분양가 중위/ }));
      expect(onCellNav).toHaveBeenCalledWith("분양가 중위", { target: "list", sort: "price" });
    });

    it("미분양률 중위 칸 → 목록 + 미분양많은순 정렬", () => {
      const onCellNav = vi.fn();
      render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} onCellNav={onCellNav} />);
      fireEvent.click(screen.getByRole("button", { name: /미분양률 중위/ }));
      expect(onCellNav).toHaveBeenCalledWith("미분양률 중위", { target: "list", sort: "unsoldRate" });
    });

    it("데이터 기준 칸은 클릭 불가 (button 아님)", () => {
      const onCellNav = vi.fn();
      render(<MarketSummaryWidget scored={scored} dataFreshnessText="2026-06-13 업데이트" onCellNav={onCellNav} />);
      expect(screen.queryByRole("button", { name: /데이터 기준/ })).toBeNull();
    });

    it("onCellNav 미전달 시 모든 칸 정적 (button 0개)", () => {
      render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });
  });
});
