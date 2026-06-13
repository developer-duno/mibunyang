// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// 훅 모킹
const mockUsePriceHistory = vi.fn();
vi.mock("@/hooks/usePriceHistory", () => ({ usePriceHistory: (/** @type {any[]} */ ...args) => mockUsePriceHistory(...args) }));

// LineChart 모킹 — 나머지 primitives는 실제 export 유지 불필요 (PriceChart는 LineChart만 사용)
vi.mock("@/components/primitives", () => ({ LineChart: (/** @type {any} */ props) => <div data-testid="line-chart" aria-label={props.yLabel} /> }));

import { PriceChart } from "./PriceChart";

function makeData(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    recorded_at: `2025-0${i + 1}-01`,
    price: 50000 + i * 1000,
  }));
}

describe("PriceChart", () => {
  beforeEach(() => { mockUsePriceHistory.mockReset(); });

  // apartmentId가 falsy이면 null
  it("apartmentId 없음 → null", () => {
    mockUsePriceHistory.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
    const { container } = render(<PriceChart apartmentId={/** @type {any} */ (null)} siblingIds={[]} />);
    expect(container.innerHTML).toBe("");
  });

  // loading 상태
  it("loading → '불러오는 중...' 표시", () => {
    mockUsePriceHistory.mockReturnValue({ data: [], loading: true, error: null, retry: vi.fn() });
    render(<PriceChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    expect(screen.getByText("불러오는 중...")).toBeTruthy();
  });

  // error 상태 + 재시도
  it("error → 에러 메시지 + 재시도 클릭", () => {
    const retry = vi.fn();
    mockUsePriceHistory.mockReturnValue({ data: [], loading: false, error: new Error("fail"), retry });
    render(<PriceChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    expect(screen.getByText("차트를 불러올 수 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByText("재시도"));
    expect(retry).toHaveBeenCalledOnce();
  });

  // data < 2 → null
  it("data 1건 → null", () => {
    mockUsePriceHistory.mockReturnValue({ data: makeData(1), loading: false, error: null, retry: vi.fn() });
    const { container } = render(<PriceChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    expect(container.innerHTML).toBe("");
  });

  // 정상 렌더
  it("data 3건 → 분양가 추이 + LineChart 렌더", () => {
    mockUsePriceHistory.mockReturnValue({ data: makeData(3), loading: false, error: null, retry: vi.fn() });
    render(<PriceChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    expect(screen.getByText("분양가 추이")).toBeTruthy();
    expect(screen.getByTestId("line-chart")).toBeTruthy();
  });

  // ? 도움말 노출
  it("정상 렌더 시 제목 옆 ? 도움말이 보인다", () => {
    mockUsePriceHistory.mockReturnValue({ data: makeData(3), loading: false, error: null, retry: vi.fn() });
    render(<PriceChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    const trigger = screen.getByRole("button", { name: "분양가 추이 풀이 보기" });
    fireEvent.click(trigger);
    expect(screen.getByText(/매주 자동으로 모아/)).toBeTruthy();
  });
});
