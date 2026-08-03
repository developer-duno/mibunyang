import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AreaPriceScatter, parsePoints, MIN_POINTS } from "./AreaPriceScatter";

/**
 * ⚠️ `document.querySelector("svg")` 로 세면 **도움말 `?` 아이콘의 SVG** 까지 잡힌다
 * (실제로 이 함정에 걸렸다 — 빈 상태인데 svg 가 있다고 나오고, 점 8개인데 10개로 셌다).
 * 차트 몸통은 `role="img"` 안에만 있으므로 거기로 범위를 좁힌다.
 */
function chartSvg() {
  return screen.queryByRole("img")?.querySelector("svg") ?? null;
}
function chartCircles() {
  return screen.queryByRole("img")?.querySelectorAll("circle") ?? [];
}

/** 실측 구조 그대로: {area, min, avg, max, count} */
function pts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    area: 30 + i * 10,
    min: 3000 + i * 900,
    avg: 3500 + i * 1000,
    max: 4000 + i * 1100,
    count: 1 + i,
  }));
}

describe("parsePoints — 이상한 입력 방어", () => {
  it("배열이 아니면 빈 배열", () => {
    for (const bad of [null, undefined, {}, "x", 3]) expect(parsePoints(bad)).toEqual([]);
  });

  it("area·avg 가 없거나 0 이하인 항목은 버린다", () => {
    const raw = [
      { area: 0, avg: 100 },
      { area: 30, avg: 0 },
      { area: 30, avg: -1 },
      { area: "x", avg: 100 },
      { area: 40, avg: 5000 },
    ];
    expect(parsePoints(raw).map((p) => p.area)).toEqual([40]);
  });

  it("min·max 가 없으면 avg 로 채운다 (막대 길이 0)", () => {
    const [p] = parsePoints([{ area: 30, avg: 5000 }]);
    expect(p.min).toBe(5000);
    expect(p.max).toBe(5000);
  });

  it("min 이 avg 보다 크게 들어와도 뒤집지 않는다 (min<=avg<=max 보장)", () => {
    const [p] = parsePoints([{ area: 30, avg: 5000, min: 9000, max: 1000 }]);
    expect(p.min).toBeLessThanOrEqual(p.avg);
    expect(p.max).toBeGreaterThanOrEqual(p.avg);
  });

  it("면적 오름차순으로 정렬한다", () => {
    const raw = [
      { area: 84, avg: 5000 },
      { area: 30, avg: 3000 },
      { area: 59, avg: 4000 },
    ];
    expect(parsePoints(raw).map((p) => p.area)).toEqual([30, 59, 84]);
  });
});

describe("AreaPriceScatter — 적은 표본은 그리지 않는다", () => {
  it(`${MIN_POINTS}건 미만이면 이유를 적고 안 그린다`, () => {
    render(<AreaPriceScatter priceByArea={pts(MIN_POINTS - 1)} aptPrice={5000} aptArea={59} />);
    expect(screen.getByText(/분포를 그리지 않았어요/)).toBeInTheDocument();
    expect(chartSvg()).toBeNull();
  });

  it("자료가 아예 없으면 다른 문구를 쓴다 (없는 것과 적은 것을 구분)", () => {
    render(<AreaPriceScatter priceByArea={null} aptPrice={5000} aptArea={59} />);
    expect(screen.getByText(/아직 모으지 못했어요/)).toBeInTheDocument();
  });

  it(`${MIN_POINTS}건부터 그린다`, () => {
    render(<AreaPriceScatter priceByArea={pts(MIN_POINTS)} aptPrice={5000} aptArea={59} />);
    expect(chartSvg()).toBeTruthy();
  });
});

describe("AreaPriceScatter — 기준선", () => {
  it("이 단지 분양가를 가로 점선으로 긋고 이름표를 단다", () => {
    render(<AreaPriceScatter priceByArea={pts(8)} aptPrice={5000} aptArea={59} />);
    expect(screen.getByText("이 단지 분양가")).toBeInTheDocument();
  });

  it("분양가가 없으면 기준선을 안 긋는다 (없는 선을 그리면 거짓말)", () => {
    render(<AreaPriceScatter priceByArea={pts(8)} aptPrice={null} aptArea={59} />);
    expect(screen.queryByText("이 단지 분양가")).toBeNull();
  });

  it("점 하나당 최저~최고 막대와 평균 점을 그린다", () => {
    render(<AreaPriceScatter priceByArea={pts(8)} aptPrice={5000} aptArea={59} />);
    expect(chartCircles()).toHaveLength(8);
  });
});

describe("AreaPriceScatter — 스크린리더", () => {
  it("분포 범위와 '분양가보다 싼 구간이 몇 개인지'를 말해준다", () => {
    render(<AreaPriceScatter priceByArea={pts(8)} aptPrice={9000} aptArea={59} />);
    const label = screen.getByRole("img").getAttribute("aria-label") || "";
    expect(label).toContain("면적");
    expect(label).toMatch(/싸게 거래된 구간이 \d+개 중 \d+개/);
    expect(label).not.toContain("점수");
  });

  it("표본이 적으면 그 사실을 읽어준다", () => {
    render(<AreaPriceScatter priceByArea={pts(2)} aptPrice={5000} aptArea={59} />);
    // 빈 상태라 role=img 가 없다 — 대신 이유 문구가 화면에 있다
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/2건뿐이라/)).toBeInTheDocument();
  });
});
