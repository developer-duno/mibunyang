// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// 훅 모킹
const mockUseUnsoldHistory = vi.fn();
vi.mock("@/hooks/useUnsoldHistory", () => ({
  useUnsoldHistory: (/** @type {any[]} */ ...args) => mockUseUnsoldHistory(...args),
}));

// LineChart 모킹
vi.mock("@/components/primitives", () => ({
  // data-x·data-x2 = 두 계열의 x 글자(세션594 — x 축 형식 시험용)
  LineChart: (/** @type {any} */ props) => (
    <div
      data-testid="line-chart"
      aria-label={props.yLabel}
      data-x={props.data.map((/** @type {any} */ d) => d.x).join(",")}
      data-x2={(props.secondaryData ?? []).map((/** @type {any} */ d) => d.x).join(",")}
    />
  ),
}));

import { UnsoldChart } from "./UnsoldChart";

function makeData(count = 3, withSecondary = false) {
  return Array.from({ length: count }, (_, i) => ({
    base_month: `20250${i + 1}`,
    unsold_count: 100 - i * 10,
    post_completion_unsold: withSecondary ? 20 - i * 5 : null,
  }));
}

describe("UnsoldChart", () => {
  beforeEach(() => {
    mockUseUnsoldHistory.mockReset();
  });

  // apartmentId가 falsy이면 null
  it("apartmentId 없음 → null", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
    const { container } = render(<UnsoldChart apartmentId={/** @type {any} */ (null)} siblingIds={[]} unsold={10} />);
    expect(container.innerHTML).toBe("");
  });

  // loading 상태
  it("loading → '불러오는 중...' 표시", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: [], loading: true, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    expect(screen.getByText("불러오는 중...")).toBeTruthy();
  });

  // error 상태 + 재시도
  it("error → 에러 메시지 + 재시도 클릭", () => {
    const retry = vi.fn();
    mockUseUnsoldHistory.mockReturnValue({ data: [], loading: false, error: new Error("fail"), retry });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    expect(screen.getByText("차트를 불러올 수 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByText("재시도"));
    expect(retry).toHaveBeenCalledOnce();
  });

  // data < 2 → null
  it("data 1건 → null", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: makeData(1), loading: false, error: null, retry: vi.fn() });
    const { container } = render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    expect(container.innerHTML).toBe("");
  });

  // 정상 렌더 + secondaryData 범례
  it("data 3건 + secondaryData → 미분양 추이 + 준공후 범례", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: makeData(3, true), loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    expect(screen.getByText("미분양 추이")).toBeTruthy();
    expect(screen.getByText("┄ 준공후")).toBeTruthy();
    expect(screen.getByTestId("line-chart")).toBeTruthy();
  });

  // ? 도움말 노출
  it("정상 렌더 시 제목 옆 ? 도움말이 보인다", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: makeData(3, true), loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    const trigger = screen.getByRole("button", { name: "미분양 추이 풀이 보기" });
    fireEvent.click(trigger);
    expect(screen.getByText(/준공후 미분양/)).toBeTruthy();
  });

  // 세션578: 현재 미분양 값이 없으면(hold·비움) 옛 이력이 있어도 그리지 않는다
  it("unsold=null + 이력 3건 → 그리지 않는다", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: makeData(3), loading: false, error: null, retry: vi.fn() });
    const { container } = render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={null} />);
    expect(container.innerHTML).toBe("");
  });

  // 0 은 "자료 있음"이라 그린다 (null 과 구분)
  it("unsold=0 + 이력 3건 → 차트를 그린다", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: makeData(3), loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={0} />);
    expect(screen.getByTestId("line-chart")).toBeTruthy();
  });

  // 세션594 사장님 결정 — x 글자는 첫 점과 1월 점만 "YY.MM", 나머지는 "MM".
  //   옛 x = base_month.slice(4) 는 연도가 전혀 없어 해가 바뀌는 자리가 안 보였고, 전부 "YY.MM" 이면 12점에서 이웃 글자와 겹쳤다.
  it("x 글자 — 첫 점은 연도까지 · 1월 점은 연도까지 · 그 밖은 월만 (두 계열 같은 글자)", () => {
    const data = [
      { base_month: "202511", unsold_count: 30, post_completion_unsold: 5 },
      { base_month: "202512", unsold_count: 20, post_completion_unsold: 4 },
      { base_month: "202601", unsold_count: 10, post_completion_unsold: 3 },
      { base_month: "202602", unsold_count: 8, post_completion_unsold: 2 },
    ];
    mockUseUnsoldHistory.mockReturnValue({ data, loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    const chart = screen.getByTestId("line-chart");
    const xs = (chart.getAttribute("data-x") ?? "").split(",");
    expect(xs[0]).toBe("25.11"); // 첫 점 = 연도까지
    expect(xs[2]).toBe("26.01"); // 1월 점 = 연도까지
    expect([xs[1], xs[3]]).toEqual(["12", "02"]); // 그 밖 = 월만
    expect(chart.getAttribute("data-x2")).toBe("25.11,12,26.01,02");
  });

  // 세션594 — 분기 꼴("20262")·달 13 처럼 월 형식이 아닌 행은 그 점을 빼고 그린다(두 계열 모두). 옛 코드는 x="2" 를 그렸다.
  //   맨 앞 행이 빠지면 남은 첫 점이 연도를 단다.
  it("분기 꼴 등 월 형식이 아닌 base_month 행은 두 계열 모두에서 빠진다", () => {
    const data = [
      { base_month: "20261", unsold_count: 777, post_completion_unsold: 77 },
      { base_month: "202604", unsold_count: 30, post_completion_unsold: 5 },
      { base_month: "20262", unsold_count: 999, post_completion_unsold: 99 },
      { base_month: "202605", unsold_count: 20, post_completion_unsold: 4 },
      { base_month: "202613", unsold_count: 888, post_completion_unsold: 88 },
      { base_month: "202606", unsold_count: 10, post_completion_unsold: 3 },
    ];
    mockUseUnsoldHistory.mockReturnValue({ data, loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    const chart = screen.getByTestId("line-chart");
    expect(chart.getAttribute("data-x")).toBe("26.04,05,06");
    expect(chart.getAttribute("data-x2")).toBe("26.04,05,06");
  });
});
