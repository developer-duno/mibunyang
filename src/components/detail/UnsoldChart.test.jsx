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

  // 세션595 D2 — 점이 6개 미만일 때 붙던 "데이터 N개 · 매월 자동 수집 누적 중" 줄은 우리 수집 상태를 손님에게
  //   말하는 글이라 지웠다(MarketStatsCharts 세션594 와 같은 꼴). 그림은 그대로 그린다.
  //   점 3개 이하는 그림 대신 문장(세션589)이라 2점은 문장, 5점은 그림이 양성 앵커다.
  it("점 2~5개여도 '수집 누적 중' 글자는 없다 — 문장·그림은 그린다", () => {
    for (const n of [2, 5]) {
      mockUseUnsoldHistory.mockReturnValue({ data: makeData(n), loading: false, error: null, retry: vi.fn() });
      const { container, unmount } = render(
        <UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />
      );
      expect(screen.getByTestId(n <= UNSOLD_SENTENCE_MAX_POINTS ? "unsold-sentence" : "line-chart")).toBeTruthy(); // 양성 앵커
      expect(container.textContent).not.toMatch(/수집|누적/);
      unmount();
    }
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
      { base_month: "202607", unsold_count: 9, post_completion_unsold: 2 },
    ];
    mockUseUnsoldHistory.mockReturnValue({ data, loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    const chart = screen.getByTestId("line-chart");
    expect(chart.getAttribute("data-x")).toBe("26.04,05,06,07");
    expect(chart.getAttribute("data-x2")).toBe("26.04,05,06,07");
  });

  // 문장 경로(점 3개 이하)도 같은 행만 쓴다 — 분기 꼴이 섞여도 문장에 "20262" 를 적지 않고, 빠진 뒤 개수로 경로를 고른다.
  it("분기 꼴 행은 문장 경로에서도 빠진다 (월 행 3개 → 문장)", () => {
    const data = [
      { base_month: "202604", unsold_count: 30 },
      { base_month: "20262", unsold_count: 999 },
      { base_month: "202605", unsold_count: 20 },
      { base_month: "202606", unsold_count: 10 },
    ];
    mockUseUnsoldHistory.mockReturnValue({ data, loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} unsold={10} />);
    expect(screen.queryByTestId("line-chart")).toBeNull();
    expect(screen.getByTestId("unsold-sentence").textContent).toBe(
      "미분양 30세대(2026-04) → 20세대(2026-05) → 10세대(2026-06)"
    );
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
