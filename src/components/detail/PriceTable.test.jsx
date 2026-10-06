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

/** 그 면적의 줄 (라벨 글자로 찾는다)
 * @param {string} label */
const rowOf = (label) =>
  /** @type {HTMLElement} */ (screen.getByText(label).closest('[data-testid="price-table-row"]'));

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

  // 로딩·오류 상태는 세션589 전과 그대로다
  it("가격 배열이 아직 없고 불러오는 중이면 자리표시 + 안내 글", () => {
    const apt = /** @type {any} */ (makeApt({ priceByArea: [] }));
    render(<PriceTable apt={apt} isLoading />);
    expect(screen.getByText("인근 매매 시세")).toBeTruthy();
    expect(screen.getByText("가격 정보를 불러오는 중…")).toBeTruthy();
  });

  it("가격 배열을 못 불러왔으면 오류 글", () => {
    const apt = /** @type {any} */ (makeApt({ priceByArea: [] }));
    render(<PriceTable apt={apt} error="fail" />);
    expect(screen.getByText("가격 정보를 불러오지 못했습니다. 새로고침해 주세요.")).toBeTruthy();
  });

  // 세션589 — 표 2개(5열)를 없애고 면적마다 범위 막대 한 줄로 (사장님 결정 V12)
  it("priceByArea가 있으면 면적마다 범위 막대 줄을 그리고, 표는 없다", () => {
    const apt = /** @type {any} */ (makeApt({ priceByArea: makePriceByArea(), area: 84 }));
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(/인근 매매 시세/)).toBeTruthy();
    expect(screen.getAllByTestId("price-table-row")).toHaveLength(3);
    // 옛 표(면적·하한·평균·상한·건수)가 되살아나면 red
    expect(container.querySelector("table")).toBeNull();
    expect(screen.queryByText("하한")).toBeNull();
    expect(screen.queryByText("상한")).toBeNull();
  });

  // ⚠️ 뮤테이션 대상: 띠 양 끝 글자(minText/maxText)를 빼면 red — 표가 하던 최저·최고가 사라진다.
  it("띠 양 끝에 최저·최고 금액을, 오른쪽에 평균(굵게)·건수를 적는다 (V12)", () => {
    const priceByArea = [{ area: 84, min: 40000, avg: 45000, max: 50000, count: 10 }];
    const apt = /** @type {any} */ (makeApt({ priceByArea, area: 84 }));
    render(<PriceTable apt={apt} />);
    const row = rowOf("★ 84㎡");
    const band = /** @type {HTMLElement} */ (row.querySelector('[data-band="sell"]'));
    const ends = [...band.querySelectorAll("span")].map((s) => s.textContent);
    expect(ends).toEqual(["4억", "5억"]); // 왼쪽 끝 = 최저, 오른쪽 끝 = 최고
    expect(row.textContent).toContain("4억 5,000만"); // 평균
    expect(row.textContent).toContain("10건");
    // 전세 자료가 없으면 전세 띠도 없다
    expect(row.querySelector('[data-band="rent"]')).toBeNull();
  });

  it("띠 위치는 최저~최고, 굵은 선은 평균 — 눈금은 0 에서 묶음의 최고가까지", () => {
    const priceByArea = [
      { area: 84, min: 25000, avg: 50000, max: 75000, count: 1 },
      { area: 94, min: 50000, avg: 80000, max: 100000, count: 1 },
    ];
    const apt = /** @type {any} */ (makeApt({ priceByArea, area: 84 }));
    render(<PriceTable apt={apt} />);
    const track = /** @type {HTMLElement} */ (rowOf("★ 84㎡").querySelector('[data-band="sell"] > div'));
    const [band, avg] = /** @type {HTMLElement[]} */ ([...track.children]);
    expect(band.style.left).toBe("25%"); // 25,000 ÷ 100,000
    expect(band.style.width).toBe("50%"); // (75,000 − 25,000) ÷ 100,000
    expect(avg.style.left).toBe("50%");
  });

  // 금액이 10억대여도 한 줄 — 옛 막대는 값 칸이 60px 라 "10억 8,410 / 만" 으로 꺾였다(S13②)
  it("10억대 금액도 줄바꿈하지 않는다", () => {
    const priceByArea = [{ area: 110, min: 56500, avg: 108410, max: 160000, count: 39 }];
    const apt = /** @type {any} */ (makeApt({ priceByArea, area: 110 }));
    render(<PriceTable apt={apt} />);
    const avg = screen.getByText("10억 8,410만");
    expect(/** @type {HTMLElement} */ (avg.parentElement).style.whiteSpace).toBe("nowrap");
    expect(screen.getByText("16억").style.whiteSpace).toBe("nowrap");
  });

  // 면적 기준 필터링 테스트 — apt.area ± 10 이내 3개 이상이면 narrow 필터 적용
  it("면적 기준 ±10㎡ 필터가 적용된다", () => {
    const areas = [60, 74, 80, 84, 90, 120];
    const apt = /** @type {any} */ (makeApt({ priceByArea: makePriceByArea(areas), area: 84 }));
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    // 84 기준 ±10 → 74, 80, 84, 90 (4개, >= 3이므로 narrow 적용)
    // 60㎡, 120㎡는 안 나와야 함
    expect(screen.queryByText("60㎡")).toBeNull();
    expect(screen.queryByText("120㎡")).toBeNull();
    expect(screen.getAllByTestId("price-table-row")).toHaveLength(4);
    // 이 단지 면적과 5㎡ 안쪽이면 ★ 로 강조한다 (80·84), 그 밖은 그냥 면적
    expect(screen.getByText("★ 84㎡")).toBeTruthy();
    expect(screen.getByText("★ 80㎡")).toBeTruthy();
    expect(screen.getByText("74㎡")).toBeTruthy();
    expect(screen.getByText(/★ = 이 단지와 비슷한 면적/)).toBeTruthy();
  });

  // 전세 시세가 있으면 같은 면적 줄에 전세 띠를 쌓는다 (옛 전세 표 대체)
  it("rentByArea가 있으면 같은 줄에 전세 띠와 전세가율 칩을 그린다", () => {
    const apt = makeApt({
      priceByArea: makePriceByArea(),
      rentByArea: makeRentByArea(),
      jeonseByArea: [{ area: 84, rate: 72 }],
      area: 84,
    });
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(/인근 매매·전세 시세/)).toBeTruthy();
    // 면적 3개 = 줄 3개 (매매 3 + 전세 3 이 6줄이 되지 않는다)
    expect(screen.getAllByTestId("price-table-row")).toHaveLength(3);
    const row = rowOf("★ 84㎡");
    expect(row.querySelector('[data-band="sell"]')).not.toBeNull();
    const rent = /** @type {HTMLElement} */ (row.querySelector('[data-band="rent"]'));
    expect([...rent.querySelectorAll("span")].map((s) => s.textContent)).toEqual(["2억", "3억"]);
    expect(screen.getByText("전세가율 72%")).toBeTruthy();
    // 전세가율이 없는 면적에는 칩이 없다("-" 로 채우지 않는다)
    expect(rowOf("74㎡").textContent).not.toContain("전세가율");
    expect(container.querySelector("table")).toBeNull();
  });

  it("전세가율 칩은 70% 이상 초록, 아래는 주황 (옛 표의 색 규칙 그대로)", () => {
    const apt = makeApt({
      priceByArea: makePriceByArea([74, 84]),
      rentByArea: makeRentByArea([74, 84]),
      jeonseByArea: [
        { area: 74, rate: 70 },
        { area: 84, rate: 69.9 },
      ],
      area: null,
    });
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("전세가율 70%").style.color).toBe("rgb(22, 163, 74)"); // C.green
    expect(screen.getByText("전세가율 69.9%").style.color).toBe("rgb(217, 119, 6)"); // C.amber
  });

  it("매매·전세 띠는 같은 눈금을 쓴다 — 전세 띠 길이가 매매 최고가 대비다", () => {
    const apt = makeApt({
      priceByArea: [{ area: 84, min: 50000, avg: 80000, max: 100000, count: 1 }],
      rentByArea: [{ area: 84, min: 20000, avg: 40000, max: 60000 }],
      area: 84,
    });
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    const track = /** @type {HTMLElement} */ (rowOf("★ 84㎡").querySelector('[data-band="rent"] > div'));
    const [band, avg] = /** @type {HTMLElement[]} */ ([...track.children]);
    expect(band.style.left).toBe("20%"); // 20,000 ÷ 100,000(매매 최고가)
    expect(band.style.width).toBe("40%");
    expect(avg.style.left).toBe("40%");
  });

  it("매매·전세의 면적이 다르면 합집합을 면적순으로 — 있는 띠만 그린다", () => {
    const apt = makeApt({
      priceByArea: makePriceByArea([74, 94]),
      rentByArea: makeRentByArea([84, 94]),
      area: null,
    });
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    const rows = screen.getAllByTestId("price-table-row");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.querySelector("span")?.textContent)).toEqual(["74㎡", "84㎡", "94㎡"]);
    // 74 = 매매만 / 84 = 전세만 / 94 = 둘 다
    expect(rows[0].querySelector('[data-band="rent"]')).toBeNull();
    expect(rows[1].querySelector('[data-band="sell"]')).toBeNull();
    expect(rows[1].textContent).toContain("전세 평균 2억 5,000만");
    expect(rows[2].querySelectorAll("[data-band]")).toHaveLength(2);
  });

  it("줄마다 스크린리더 문장이 있고 '점수' 글자는 없다", () => {
    const apt = makeApt({
      priceByArea: makePriceByArea([84]),
      rentByArea: makeRentByArea([84]),
      jeonseByArea: [{ area: 84, rate: 72 }],
      area: 84,
    });
    render(<PriceTable apt={/** @type {any} */ (apt)} />);
    const label = rowOf("★ 84㎡").getAttribute("aria-label") ?? "";
    expect(label).toContain("매매 최저 4억 8,400만, 평균 5억 3,400만, 최고 5억 8,400만, 5건");
    expect(label).toContain("전세 최저 2억, 평균 2억 5,000만, 최고 3억");
    expect(label).toContain("전세가율 72%");
    expect(label).not.toContain("점수");
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
    // 건수가 없으면 "건" 글자만 남기지 않는다
    expect(rowOf("★ 84㎡").textContent).not.toMatch(/건/);
  });

  // 세션576 D2 — 면적이 없는(null) 단지는 거르지 않는다. 옛 코드는 null 을 0㎡ 로 바꿔
  // "0㎡ 기준 ±20㎡" 로 걸러 행이 전부 사라졌다.
  it("면적이 없으면 매매 줄을 거르지 않고 '총 N건 · 전체 면적' 을 띄운다 (D2)", () => {
    const apt = makeApt({ priceByArea: makePriceByArea([74, 84, 94]), area: null });
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getAllByTestId("price-table-row")).toHaveLength(3);
    expect(screen.getByText("총 15건 · 전체 면적")).toBeTruthy();
    expect(container.textContent).not.toContain("0㎡ 기준");
    expect(container.textContent).not.toContain("필터");
    // 면적을 모르면 "비슷한 면적" 강조도 없다
    expect(container.textContent).not.toContain("★");
  });

  // 검사관 보강 — 0 도 "면적 없음"이다(hasKnownArea 의 `> 0` 경계). 0㎡ 로 거르면 행이 사라진다.
  it("면적이 0 이어도 매매 줄을 거르지 않고 '총 N건 · 전체 면적' 을 띄운다 (D2 경계)", () => {
    const apt = makeApt({ priceByArea: makePriceByArea([74, 84, 94]), area: 0 });
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getAllByTestId("price-table-row")).toHaveLength(3);
    expect(screen.getByText("총 15건 · 전체 면적")).toBeTruthy();
    expect(container.textContent).not.toContain("0㎡ 기준");
  });

  it("면적이 없으면 전세도 거르지 않는다 — 세 줄 전부에 전세 띠 + '전체 면적' 한 번 (D2)", () => {
    const apt = makeApt({
      priceByArea: makePriceByArea([74, 84, 94]),
      rentByArea: makeRentByArea([74, 84, 94]),
      area: null,
    });
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getAllByTestId("price-table-row")).toHaveLength(3);
    expect(container.querySelectorAll('[data-band="rent"]')).toHaveLength(3);
    // 매매·전세 범위가 같으면 한 번만 적는다
    expect(screen.getByText("전체 면적 · 매매 총 15건")).toBeTruthy();
  });

  // 세션576 E4 — 전세 쪽 문구는 전세 자신이 걸렸는지로 정한다. 매매만 걸리고 전세는 전부일 때
  // 옛 코드는 매매의 isFiltered 를 빌려 "84㎡ 기준 ±20㎡ 필터" 라고 찍었다.
  // 세션589 — 두 표가 한 묶음이 되면서 한 줄에 각각 사실대로 적는다.
  it("매매만 걸리고 전세는 전부면 '매매 …필터 · 전세 전체 면적' 으로 각각 적는다 (E4)", () => {
    const apt = makeApt({
      priceByArea: makePriceByArea([60, 74, 80, 84, 90, 120]),
      rentByArea: makeRentByArea([84]),
      area: 84,
    });
    const { container } = render(<PriceTable apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("매매 84㎡ 기준 ±10㎡ 필터 · 전세 전체 면적 · 매매 총 30건")).toBeTruthy();
    expect(container.textContent).not.toContain("±20㎡");
  });
});
