// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceTable } from "./PriceTable";
import { makeApt } from "@/__tests__/factories";

// 테스트용 매매 시세 데이터 생성
function makePriceByArea(areas = [74, 84, 94]) {
  return areas.map(area => ({
    area, min: 40000 + area * 100, avg: 45000 + area * 100, max: 50000 + area * 100, count: 5,
  }));
}

function makeRentByArea(areas = [74, 84, 94]) {
  return areas.map(area => ({
    area, min: 20000, avg: 25000, max: 30000,
  }));
}

describe("PriceTable", () => {
  // priceByArea가 빈 배열이면 null 반환 (아무것도 렌더링하지 않음)
  it("priceByArea가 빈 배열이면 아무것도 렌더링하지 않는다", () => {
    const apt = /** @type {any} */ (makeApt({ priceByArea: [] }));
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(container.innerHTML).toBe("");
  });

  // priceByArea가 null이면 null 반환
  it("priceByArea가 null이면 아무것도 렌더링하지 않는다", () => {
    const apt = /** @type {any} */ (makeApt({ priceByArea: null }));
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(container.innerHTML).toBe("");
  });

  // priceByArea가 undefined이면 null 반환
  it("priceByArea가 undefined이면 아무것도 렌더링하지 않는다", () => {
    const apt = /** @type {any} */ (makeApt());
    // makeApt에 priceByArea가 없으면 undefined
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(container.innerHTML).toBe("");
  });

  // 정상 데이터가 있으면 테이블 렌더링
  it("priceByArea가 있으면 매매 시세 테이블을 렌더링한다", () => {
    const apt = /** @type {any} */ (makeApt({ priceByArea: makePriceByArea(), area: 84 }));
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(/인근 매매 시세/)).toBeTruthy();
    expect(screen.getByText("면적")).toBeTruthy();
    expect(screen.getByText("하한")).toBeTruthy();
    expect(screen.getByText("평균")).toBeTruthy();
  });

  // 면적 기준 필터링 테스트 — apt.area ± 10 이내 3개 이상이면 narrow 필터 적용
  it("면적 기준 ±10㎡ 필터가 적용된다", () => {
    const areas = [60, 74, 80, 84, 90, 120];
    const apt = /** @type {any} */ (makeApt({ priceByArea: makePriceByArea(areas), area: 84 }));
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    // 84 기준 ±10 → 74, 80, 84, 90 (4개, >= 3이므로 narrow 적용)
    // 60㎡, 120㎡는 테이블에 안 나와야 함
    expect(screen.queryByText("60㎡")).toBeNull();
    expect(screen.queryByText("120㎡")).toBeNull();
    expect(screen.getByText("84㎡")).toBeTruthy();
  });

  // 전세 시세가 있으면 전세 테이블도 렌더링
  it("rentByArea가 있으면 전세 시세 테이블도 렌더링한다", () => {
    const apt = makeApt({
      priceByArea: makePriceByArea(),
      rentByArea: makeRentByArea(),
      jeonseByArea: [{ area: 84, rate: 72 }],
      area: 84,
    });
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(/인근 전세 시세/)).toBeTruthy();
    expect(screen.getByText("72%")).toBeTruthy();
  });

  // 총 건수 합산 표시
  it("총 거래 건수를 합산하여 표시한다", () => {
    const priceByArea = [
      { area: 84, min: 40000, avg: 45000, max: 50000, count: 10 },
      { area: 94, min: 42000, avg: 47000, max: 52000, count: 5 },
    ];
    const apt = /** @type {any} */ (makeApt({ priceByArea, area: 84 }));
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(/총 15건/)).toBeTruthy();
  });

  // count가 null인 경우 안전하게 처리
  it("count가 null인 항목도 안전하게 처리한다", () => {
    const priceByArea = [
      { area: 84, min: 40000, avg: 45000, max: 50000, count: null },
    ];
    const apt = /** @type {any} */ (makeApt({ priceByArea, area: 84 }));
    // count가 null이면 0으로 처리되어야 크래시 없음
    expect(() => render(<PriceTable apt={/** @type {any} */ (apt)} />)).not.toThrow();
  });
});
