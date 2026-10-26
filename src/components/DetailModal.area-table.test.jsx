// @ts-check
/**
 * 시세 탭 평형별 실거래 표(세션662) — 정적 모드에서 complexTable 은 목록 행에 없고 상세 버킷에만 있다
 * (scripts/static-outputs.mjs DETAIL_ONLY). 표가 병합본(mergedApt)을 읽는지, 그리고 창을 닫지 않고 단지를 바꿀 때
 * 옛 버킷(detail)이 새 단지에 붙지 않는지 지킨다.
 *
 * 상세 버킷 조회(fetchApartmentDetail)만 가짜로 바꾸므로 다른 DetailModal 시험과 섞이지 않게 새 파일로 둔다.
 * ⚠️ 뮤테이션 대상: DetailModal.tsx 의 AreaTradeTable apt 를 `apt` 로 바꾸면 ① 빨강 · 가드를 빼면(`mergedApt ?? apt`) ② 빨강 ·
 *   가드를 옛 `detail.id === apt.id` 로 되돌리면 ① 빨강(버킷 행엔 id 가 없다).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailModal } from "./DetailModal";
import { makeScoredItem } from "@/__tests__/factories";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const fetchApartmentDetail = vi.fn();
vi.mock("@/services/staticDataApi", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, fetchApartmentDetail: (/** @type {string} */ id) => fetchApartmentDetail(id) };
});

/** 최소한의 cats 구조 (DetailModal.notice-name.test.jsx 와 같은 꼴) */
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

/**
 * @param {any} item
 * @returns {any}
 */
function makeProps(item) {
  return { item, onClose: vi.fn(), isComp: false, onComp: vi.fn(), isFav: false, onFav: vi.fn(), onShare: vi.fn() };
}

/** 목록 행 — complexTable 없음 · priceByArea undefined(정적 모드 → 버킷 조회 발동) */
const listApt = (/** @type {string} */ id) => ({
  id,
  name: id,
  area: 84.99,
  priceByArea: undefined,
  cmpScope: "complex",
  cmpFairPrice: 77000,
  cmpN: 6,
  cmpMonths: 12,
  cmpAreaMode: "same_area",
  cmpSrc: "sale",
});

/**
 * fetchApartmentDetail 이 돌려주는 상세 칸 — 실제 staticDataApi(loadDetailBucketOnce)처럼 **id 를 뗀** 모양.
 * (세션662 결함: id 가 붙은 가짜로 시험해 `detail.id === apt.id` 가드가 운영에서 늘 거짓인 것을 놓쳤다)
 */
const bucket = () => ({
  priceByArea: [],
  rentByArea: [],
  jeonseByArea: [],
  priceByFloor: [],
  complexTable: [
    { area: 59.99, n: 13, min: 58000, median: 61000, max: 64200, last_month: "202609" },
    { area: 84.99, n: 6, min: 74000, median: 77000, max: 80000, last_month: "202608" },
  ],
  complexJeonseTable: [],
});

const openPrice = () => fireEvent.click(screen.getByRole("tab", { name: "시세" }));

describe("DetailModal 평형별 실거래 표 — 상세 버킷의 complexTable 을 읽는다(정적 모드)", () => {
  it("① 목록 행엔 complexTable 이 없고 상세 버킷이 주면 표가 뜬다", async () => {
    fetchApartmentDetail.mockResolvedValue(bucket());
    const item = makeItem(listApt("ah-1"));
    expect(/** @type {any} */ (item.apt).complexTable).toBeUndefined();
    render(<DetailModal {...makeProps(item)} />);
    openPrice();
    expect(bucket()).not.toHaveProperty("id");
    const table = await screen.findByTestId("area-trade-table");
    expect(table.querySelectorAll("[data-area-group]")).toHaveLength(2);
  });

  it("② 창을 닫지 않고 다른 단지로 바꾸면, 새 버킷이 오기 전엔 옛 단지 표를 붙이지 않는다", async () => {
    fetchApartmentDetail.mockImplementation((/** @type {string} */ id) =>
      id === "ah-1" ? Promise.resolve(bucket()) : new Promise(() => {})
    );
    const { rerender } = render(<DetailModal {...makeProps(makeItem(listApt("ah-1")))} />);
    openPrice();
    expect(await screen.findByTestId("area-trade-table")).toBeTruthy();

    rerender(<DetailModal {...makeProps(makeItem(listApt("ah-2")))} />);
    // ah-2 버킷은 끝나지 않는다 — 옛 detail(ah-1)이 남아 있어도 표는 없어야 한다
    expect(screen.getAllByText("ah-2").length).toBeGreaterThan(0);
    if (!document.querySelector("#sec-price:not([style*='display: none'])")) openPrice();
    expect(screen.queryByTestId("area-trade-table")).toBeNull();
  });
});
