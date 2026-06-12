// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
