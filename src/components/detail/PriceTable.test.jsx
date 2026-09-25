// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceTable } from "./PriceTable";
import { makeApt } from "@/__tests__/factories";

// 테스트용 매매 시세 데이터 생성
function makePriceByArea(areas = [74, 84, 94]) {
  return areas.map((area) => ({
    area,
    min: 40000 + area * 100,
    avg: 45000 + area * 100,
    max: 50000 + area * 100,
    count: 5,
  }));
}

function makeRentByArea(areas = [74, 84, 94]) {
  return areas.map((area) => ({
    area,
    min: 20000,
    avg: 25000,
    max: 30000,
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
    const priceByArea = [{ area: 84, min: 40000, avg: 45000, max: 50000, count: null }];
    const apt = /** @type {any} */ (makeApt({ priceByArea, area: 84 }));
    // count가 null이면 0으로 처리되어야 크래시 없음
    expect(() => render(<PriceTable apt={/** @type {any} */ (apt)} />)).not.toThrow();
  });

  // 세션576 D2 — 면적이 없는(null) 단지는 거르지 않는다. 옛 코드는 null 을 0㎡ 로 바꿔
  // "0㎡ 기준 ±20㎡" 로 걸러 행이 전부 사라졌다.
  it("면적이 없으면 매매 표를 거르지 않고 '총 N건 · 전체 면적' 을 띄운다 (D2)", () => {
    const apt = makeApt({ priceByArea: makePriceByArea([74, 84, 94]), area: null });
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getAllByTestId("price-table-row")).toHaveLength(3);
    expect(screen.getByText("총 15건 · 전체 면적")).toBeTruthy();
    expect(container.textContent).not.toContain("0㎡ 기준");
    expect(container.textContent).not.toContain("필터");
  });

  it("면적이 없으면 전세 표도 거르지 않는다 — 세 행 전부 + '전체 면적' (D2)", () => {
    const apt = makeApt({
      priceByArea: makePriceByArea([74, 84, 94]),
      rentByArea: makeRentByArea([74, 84, 94]),
      area: null,
    });
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    const tables = container.querySelectorAll("table");
    expect(tables).toHaveLength(2);
    expect(tables[1].querySelectorAll("tbody tr")).toHaveLength(3);
    expect(screen.getByText("전체 면적")).toBeTruthy();
  });

  // 세션576 E4 — 전세 라벨은 전세 표 자신이 걸렸는지로 정한다. 매매만 걸리고 전세는 전부일 때
  // 옛 코드는 매매의 isFiltered 를 빌려 "84㎡ 기준 ±20㎡ 필터" 라고 찍었다.
  it("매매만 걸리고 전세는 전부면 전세 라벨은 '전체 면적' 이다 (E4)", () => {
    const apt = makeApt({
      priceByArea: makePriceByArea([60, 74, 80, 84, 90, 120]),
      rentByArea: makeRentByArea([84]),
      area: 84,
    });
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("총 30건 · 84㎡ 기준 ±10㎡ 필터")).toBeTruthy();
    expect(screen.getByText("전체 면적")).toBeTruthy();
    expect(screen.queryByText("84㎡ 기준 ±20㎡ 필터")).toBeNull();
  });
});
