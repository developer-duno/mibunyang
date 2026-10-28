// @ts-check
/**
 * 상세 창 맨 아래 "경로 줄 + 같은 구 가까운 단지 칩" (세션671 PR-S3 · 결정 40~43).
 *
 * 막는 것:
 *  - 블록이 탭 패널 뒤 · CTA 바 앞이 아닌 자리에 들어감 / 새 링크가 모달의 마지막 포커서블이 됨(포커스 트랩 불변식)
 *  - 칩 그냥 클릭이 새 페이지로 가 버림(앱 안 상세 열기 안 됨) / 수정 키 클릭까지 가로챔
 *  - 경로 줄·전체 보기 링크를 앱이 가로챔(허브는 새 페이지여야 한다)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DetailModal } from "./DetailModal";
import { makeScoredItem } from "@/__tests__/factories";
import { createNearbyIndex } from "@/utils/nearbyComplexes.mjs";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/services/staticDataApi", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, fetchApartmentDetail: () => Promise.resolve(null) };
});

const KM_PER_DEG = (2 * Math.PI * 6371) / 360;
/** @param {string} id @param {number} km @param {Record<string, unknown>} [o] */
const row = (id, km, o = {}) => ({
  id,
  name: `단지${id}`,
  region: "서울",
  gu: "구로구",
  lat: 37.5 + km / KM_PER_DEG,
  lng: 126.9,
  unsold: 5,
  ...o,
});

const SELF = row("s", 0, { name: "신영지웰" });
const LIST = [SELF, row("a", 0.91, { unsold: 29 }), row("b", 1.72, { unsold: 0 }), row("c", 1.28)];

function makeItem() {
  return makeScoredItem(SELF, {
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
function props(over = {}) {
  return {
    item: makeItem(),
    onClose: vi.fn(),
    isComp: false,
    onComp: vi.fn(),
    isFav: false,
    onFav: vi.fn(),
    onShare: vi.fn(),
    onConsult: vi.fn(),
    isPC: false,
    isDesktop: false,
    nearbyIndex: createNearbyIndex(LIST),
    onOpenApt: vi.fn(),
    ...over,
  };
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

describe("DetailModal — 경로 줄 + 같은 구 가까운 단지 (세션671)", () => {
  it("경로 줄 · 머리글 · 칩(미분양 남은 단지 가까운 순 → 나머지) · 전체 보기", () => {
    render(<DetailModal {...props()} />);
    const block = screen.getByTestId("detail-nearby");
    const nav = within(block).getByRole("navigation", { name: "경로" });
    expect(Array.from(nav.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["전국", "/"],
      ["서울", "/region/%EC%84%9C%EC%9A%B8"],
      ["구로구", "/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC"],
    ]);
    expect(nav.textContent).toContain("신영지웰");
    expect(within(block).getByRole("heading", { name: "구로구 가까운 단지" })).toBeInTheDocument();
    expect(within(block).getByText("직선거리")).toBeInTheDocument();
    const chips = within(block).getAllByTestId("detail-nearby-chip");
    expect(chips.map((c) => [c.getAttribute("href"), c.textContent])).toEqual([
      ["/apt/a", "단지a0.9km · 미분양 29세대"],
      ["/apt/c", "단지c1.3km · 미분양 5세대"],
      ["/apt/b", "단지b1.7km · 분양 완료"],
    ]);
    const all = within(block).getByTestId("detail-nearby-all");
    expect(all.textContent).toBe("구로구 분양·미분양 4곳 전체 보기 ›");
    expect(all.getAttribute("href")).toBe("/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC");
  });

  it("색인이 없으면 블록을 그리지 않는다 · 칩 0개면 경로 줄만", () => {
    const { unmount } = render(<DetailModal {...props({ nearbyIndex: null })} />);
    expect(screen.queryByTestId("detail-nearby")).toBeNull();
    unmount();
    render(<DetailModal {...props({ nearbyIndex: createNearbyIndex([SELF]) })} />);
    const block = screen.getByTestId("detail-nearby");
    expect(within(block).getByRole("navigation", { name: "경로" })).toBeInTheDocument();
    expect(within(block).queryByTestId("detail-nearby-chip")).toBeNull();
    expect(within(block).queryByTestId("detail-nearby-all")).toBeNull();
    expect(within(block).queryByRole("heading")).toBeNull();
  });

  it("휴대폰: 탭 패널 뒤 · CTA 바 앞, 칩 2열 · 새 링크는 마지막 포커서블이 아니다", () => {
    render(<DetailModal {...props({ fabOverlaps: true })} />);
    const block = screen.getByTestId("detail-nearby");
    const panels = document.querySelectorAll("[data-tab-panel]");
    const lastPanel = panels[panels.length - 1];
    expect(lastPanel.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const spacer = screen.getByTestId("detail-fab-spacer");
    const cta = screen.getByTestId("detail-cta-bar");
    expect(block.compareDocumentPosition(spacer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("detail-nearby-chips").style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    const focusable = screen.getByRole("dialog").querySelectorAll(FOCUSABLE);
    const last = focusable[focusable.length - 1];
    expect(block.contains(last)).toBe(false);
    expect(cta.contains(last)).toBe(true);
  });

  it("PC: 본문 스크롤러 안 맨 아래, 칩 3열 · 오른쪽 레일이 DOM 상 뒤라 새 링크는 마지막 포커서블이 아니다", () => {
    render(<DetailModal {...props({ isPC: true, isDesktop: true })} />);
    const block = screen.getByTestId("detail-nearby");
    expect(screen.getByTestId("detail-scroll-body").contains(block)).toBe(true);
    expect(screen.queryByTestId("detail-cta-bar")).toBeNull();
    expect(screen.getByTestId("detail-nearby-chips").style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    const rail = screen.getByTestId("detail-rail");
    const focusable = screen.getByRole("dialog").querySelectorAll(FOCUSABLE);
    const last = focusable[focusable.length - 1];
    expect(block.contains(last)).toBe(false);
    expect(rail.contains(last)).toBe(true);
  });

  it("포커스 트랩: 마지막 포커서블에서 Tab = 닫기 단추로 순환(블록이 경계를 빼앗지 않음)", () => {
    render(<DetailModal {...props()} />);
    const focusable = screen.getByRole("dialog").querySelectorAll(FOCUSABLE);
    const last = /** @type {HTMLElement} */ (focusable[focusable.length - 1]);
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("닫기"));
  });

  it("칩 그냥 클릭 = 기본 동작 막고 onOpenApt(id) · Ctrl/Meta/Shift/Alt·가운데 = 브라우저 기본", () => {
    const onOpenApt = vi.fn();
    render(<DetailModal {...props({ onOpenApt })} />);
    const chip = screen.getAllByTestId("detail-nearby-chip")[0];
    expect(fireEvent.click(chip)).toBe(false); // preventDefault 됨
    expect(onOpenApt).toHaveBeenCalledWith("a");
    onOpenApt.mockClear();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(fireEvent.click(chip, mod)).toBe(true);
    }
    expect(onOpenApt).not.toHaveBeenCalled();
  });

  it("칩은 Tab 으로 닿고(링크) Enter 가 클릭으로 들어온다", () => {
    const onOpenApt = vi.fn();
    render(<DetailModal {...props({ onOpenApt })} />);
    const chip = screen.getAllByTestId("detail-nearby-chip")[1];
    expect(chip.tagName).toBe("A");
    expect(chip.getAttribute("tabindex")).toBeNull();
    chip.focus();
    expect(document.activeElement).toBe(chip);
    fireEvent.click(chip, { detail: 0 }); // 키보드 Enter 가 만드는 click
    expect(onOpenApt).toHaveBeenCalledWith("c");
  });

  it("경로 줄·전체 보기 = 보통 링크(앱이 가로채지 않음) · onOpenApt 없으면 칩도 보통 링크", () => {
    const onOpenApt = vi.fn();
    const { unmount } = render(<DetailModal {...props({ onOpenApt })} />);
    const block = screen.getByTestId("detail-nearby");
    for (const a of Array.from(within(block).getByRole("navigation", { name: "경로" }).querySelectorAll("a"))) {
      expect(fireEvent.click(a)).toBe(true);
    }
    expect(fireEvent.click(screen.getByTestId("detail-nearby-all"))).toBe(true);
    expect(onOpenApt).not.toHaveBeenCalled();
    unmount();
    render(<DetailModal {...props({ onOpenApt: undefined })} />);
    expect(fireEvent.click(screen.getAllByTestId("detail-nearby-chip")[0])).toBe(true);
  });

  it("모든 탭에서 보인다(탭을 바꿔도 같은 자리)", () => {
    render(<DetailModal {...props()} />);
    fireEvent.click(screen.getByRole("tab", { name: /시세/ }));
    expect(screen.getByTestId("detail-nearby")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: /점수/ }));
    expect(screen.getByTestId("detail-nearby")).toBeVisible();
  });
});
