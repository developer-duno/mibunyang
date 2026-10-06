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
  LineChart: (/** @type {any} */ props) => <div data-testid="line-chart" aria-label={props.yLabel} />,
}));

import { UnsoldChart, unsoldSentence, UNSOLD_SENTENCE_MAX_POINTS } from "./UnsoldChart";

function makeData(count = 3, withSecondary = false) {
  return Array.from({ length: count }, (_, i) => ({
    base_month: `20250${i + 1}`,
    unsold_count: 100 - i * 10,
    post_completion_unsold: withSecondary ? 20 - i * 5 : null,
  }));
}

/** 훅이 돌려줄 값 고정
 * @param {any[]} data */
const withData = (data) => mockUseUnsoldHistory.mockReturnValue({ data, loading: false, error: null, retry: vi.fn() });

describe("UnsoldChart", () => {
  beforeEach(() => {
    mockUseUnsoldHistory.mockReset();
  });

  // apartmentId가 falsy이면 null
  it("apartmentId 없음 → null", () => {
    withData([]);
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
    withData(makeData(1));
    const { container } = render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    expect(container.innerHTML).toBe("");
  });

  // ── 세션589: 점이 3개 이하면 차트 대신 한 줄 문장 ──────────────────────────────
  // 점 2~3개로 선을 그으면 세로축을 꽉 채워 한 칸 변화가 급등처럼 보인다(204px 차지).
  // ⚠️ 뮤테이션 대상: 경계(UNSOLD_SENTENCE_MAX_POINTS)를 2 나 4 로 바꾸면 아래 둘 중 하나가 red.
  it("경계 상수는 3 이다 (리터럴로 못 박는다)", () => {
    expect(UNSOLD_SENTENCE_MAX_POINTS).toBe(3);
  });

  it("data 2건 → 차트 없이 한 줄 문장", () => {
    withData([
      { base_month: "202608", unsold_count: 318, post_completion_unsold: null },
      { base_month: "202609", unsold_count: 280, post_completion_unsold: null },
    ]);
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={280} />);
    expect(screen.getByText("미분양 추이")).toBeTruthy();
    expect(screen.getByTestId("unsold-sentence").textContent).toBe("미분양 318세대(2026-08) → 280세대(2026-09)");
    expect(screen.queryByTestId("line-chart")).toBeNull();
  });

  it("data 3건(경계) → 아직 문장", () => {
    withData(makeData(3, true));
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    expect(screen.getByTestId("unsold-sentence").textContent).toBe(
      "미분양 100세대(2025-01) → 90세대(2025-02) → 80세대(2025-03)"
    );
    expect(screen.queryByTestId("line-chart")).toBeNull();
  });

  it("data 4건(경계 바로 위) → 차트", () => {
    withData(makeData(4));
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    expect(screen.getByTestId("line-chart")).toBeTruthy();
    expect(screen.queryByTestId("unsold-sentence")).toBeNull();
  });

  it("문장일 때도 제목 옆 ? 도움말이 있고, 그래프 대신 숫자로 적은 이유를 말한다", () => {
    withData(makeData(2));
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    fireEvent.click(screen.getByRole("button", { name: "미분양 추이 풀이 보기" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/그래프 대신 숫자로/);
  });

  // 정상 렌더 + secondaryData 범례
  it("data 4건 + secondaryData → 미분양 추이 + 준공후 범례", () => {
    withData(makeData(4, true));
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    expect(screen.getByText("미분양 추이")).toBeTruthy();
    expect(screen.getByText("┄ 준공후")).toBeTruthy();
    expect(screen.getByTestId("line-chart")).toBeTruthy();
  });

  // ? 도움말 노출
  it("차트일 때 제목 옆 ? 도움말이 보인다", () => {
    withData(makeData(4, true));
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    const trigger = screen.getByRole("button", { name: "미분양 추이 풀이 보기" });
    fireEvent.click(trigger);
    expect(screen.getByText(/준공후 미분양/)).toBeTruthy();
  });

  // 세션578: 현재 미분양 값이 없으면(hold·비움) 옛 이력이 있어도 그리지 않는다
  it("unsold=null + 이력 4건 → 그리지 않는다", () => {
    withData(makeData(4));
    const { container } = render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={null} />);
    expect(container.innerHTML).toBe("");
  });

  // 세션589 F1 — 안 그릴 단지는 이력도 부르지 않는다. 훅은 id 가 비면 요청을 안 보낸다
  // (`useHistoryData` 의 `if (!apartmentId) return`) — 그래서 id 자리에 null 을 넘긴다.
  // ⚠️ 뮤테이션 대상: 훅에 apartmentId 를 그대로 넘기면 red.
  it("unsold=null 이면 훅에 id 를 넘기지 않는다 (API 를 부르지 않는다)", () => {
    withData([]);
    render(<UnsoldChart apartmentId="ap-1" siblingIds={["ap-1", "ap-2"]} unsold={null} />);
    expect(mockUseUnsoldHistory).toHaveBeenCalledWith(null, ["ap-1", "ap-2"]);
  });

  it("unsold 값이 있으면(0 포함) 훅에 id 를 그대로 넘긴다", () => {
    withData([]);
    render(<UnsoldChart apartmentId="ap-1" siblingIds={[]} unsold={0} />);
    expect(mockUseUnsoldHistory).toHaveBeenCalledWith("ap-1", []);
  });

  // 0 은 "자료 있음"이라 그린다 (null 과 구분)
  it("unsold=0 + 이력 4건 → 차트를 그린다", () => {
    withData(makeData(4));
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={0} />);
    expect(screen.getByTestId("line-chart")).toBeTruthy();
  });

  it("unsold=0 + 이력 2건 → 문장을 그린다", () => {
    withData(makeData(2));
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={0} />);
    expect(screen.getByTestId("unsold-sentence")).toBeTruthy();
  });
});

describe("unsoldSentence — 점 몇 개를 한 문장으로", () => {
  it("값이 전부 같으면 '변동 없음' 을 붙인다", () => {
    expect(
      unsoldSentence([
        { base_month: "202606", unsold_count: 1 },
        { base_month: "202607", unsold_count: 1 },
      ])
    ).toBe("미분양 1세대(2026-06) → 1세대(2026-07) · 변동 없음");
  });

  it("천 단위 쉼표를 찍는다", () => {
    expect(unsoldSentence([{ base_month: "202606", unsold_count: 1234 }])).toBe("미분양 1,234세대(2026-06)");
  });

  it("값이 빈 달은 0 으로 적지 않고 뺀다", () => {
    expect(
      unsoldSentence([
        { base_month: "202606", unsold_count: null },
        { base_month: "202607", unsold_count: 12 },
      ])
    ).toBe("미분양 12세대(2026-07)");
  });

  it("전부 비었으면 null", () => {
    expect(unsoldSentence([{ base_month: "202606", unsold_count: null }])).toBeNull();
    expect(unsoldSentence([])).toBeNull();
  });

  it("기준월이 YYYYMM 꼴이 아니면 받은 글자 그대로 적는다 (날짜로 해석하지 않는다)", () => {
    expect(unsoldSentence([{ base_month: "2026-6", unsold_count: 3 }])).toBe("미분양 3세대(2026-6)");
  });
});
