// @ts-check
/**
 * DetailModal → UnsoldChart 로 넘어가는 unsold prop 시험 (세션582, BACKLOG A-13 "DetailModal.tsx:775").
 *
 * DetailModal.tsx:772-776 의 `unsold={(apt.unsold as number | null | undefined) ?? null}` 줄을
 * 지워도 vitest·tsc·eslint 가 초록이던 시험 사각을 메운다. UnsoldChart 는 내부에서
 * useUnsoldHistory(fetch 훅)를 쓰므로, 실제 렌더 대신 props 를 잡는 가짜로 대체한다
 * (기존 DetailModal.test.jsx 에 이 mock 을 넣으면 그 파일의 모든 테스트가 영향을 받으므로
 * 새 파일로 분리 — 지시서 항목 4).
 *
 * ⚠️ 뮤테이션 대상: DetailModal.tsx 의 `unsold=` 줄을 지우면 이 파일의 시험이 빨강이어야 한다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailModal } from "./DetailModal";
import { makeScoredItem } from "@/__tests__/factories";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

// UnsoldChart 를 props 캡처용 가짜로 — apartmentId/siblingIds/unsold 를 화면에 문자열로 노출해
// 실제 차트·fetch 훅(useUnsoldHistory) 없이 어떤 prop 이 전달됐는지 검증한다.
vi.mock("./detail/UnsoldChart", () => ({
  UnsoldChart: (/** @type {{ apartmentId?: unknown, siblingIds?: unknown, unsold?: unknown }} */ props) => (
    <div data-testid="unsold-chart-mock" data-unsold={JSON.stringify(props.unsold ?? null)}>
      unsold-chart-mock
    </div>
  ),
}));

/** 최소한의 cats 구조 (DetailModal.test.jsx makeItem 과 동일 형태) */
function makeItem(aptOverrides = {}) {
  return makeScoredItem(aptOverrides, {
    cats: {
      price: { label: "가격 매력도", total: 70, fairPrice: 48000, deviation: "-3.2", subs: [] },
      location: { label: "입지·생활권", total: 80, subs: [] },
      product: { label: "상품성", total: 65, subs: [] },
      benefit: { label: "혜택·할인", total: 60, totalWon: 0, rate: 0, subs: [] },
      risk: { label: "안전도", total: 85, subs: [] },
      future: { label: "미래가치", total: 72, subs: [] },
    },
  });
}

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    item: makeItem(),
    onClose: vi.fn(),
    isComp: false,
    onComp: vi.fn(),
    isFav: false,
    onFav: vi.fn(),
    onShare: vi.fn(),
    isPC: false,
    ...overrides,
  };
}

describe("DetailModal → UnsoldChart unsold prop", () => {
  it("apt.unsold 값이 있으면 UnsoldChart 에 그 값이 그대로 전달된다", () => {
    render(<DetailModal {...makeProps({ item: makeItem({ unsold: 37 }) })} />);
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));

    const mock = screen.getByTestId("unsold-chart-mock");
    expect(JSON.parse(mock.dataset.unsold ?? "null")).toBe(37);
  });

  it("apt.unsold 가 undefined 면 UnsoldChart 에 null 이 전달된다", () => {
    render(<DetailModal {...makeProps({ item: makeItem({ unsold: undefined }) })} />);
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));

    const mock = screen.getByTestId("unsold-chart-mock");
    expect(JSON.parse(mock.dataset.unsold ?? "null")).toBeNull();
  });
});
