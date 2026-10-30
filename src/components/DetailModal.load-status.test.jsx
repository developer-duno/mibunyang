// @ts-check
/**
 * 시세 탭 맨 위 상세 묶음 불러오기 상태 한 줄(세션675 H1 — 맹점 🟠3).
 * 옛 소비처(시·군·구 시세 표·대출 분석 표)를 지워 pricesLoading·pricesError 를 읽는 곳이 0 이 됐다 → 묶음을 못 불러와도
 * 화면에 아무 표시가 없었다. 실패 = 안내 + 다시 불러오기 · 단추 = 같은 fetch 를 다시 · 성공 = 아무것도 없음.
 * ⚠️ 뮤테이션 대상: effect 의존값에서 detailRetry 를 빼면 ② 빨강 · 실패 줄 조건을 지우면 ① 빨강.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DetailModal } from "./DetailModal";
import { makeScoredItem } from "@/__tests__/factories";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const fetchApartmentDetail = vi.fn();
vi.mock("@/services/staticDataApi", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, fetchApartmentDetail: (/** @type {string} */ id) => fetchApartmentDetail(id) };
});

/** 정적 모드 목록 행 — priceByArea undefined 라 상세 묶음 조회가 발동한다 */
const item = () =>
  makeScoredItem(
    { id: "ah-9", name: "시험단지", area: 84.99, priceByArea: undefined },
    {
      cats: {
        price: { label: "가격 매력도", total: 70, fairPrice: 0, deviation: null, subs: [] },
        location: { label: "입지·생활권", total: 80, subs: [] },
        product: { label: "상품성", total: 65, subs: [] },
        benefit: { label: "혜택·할인", total: 60, totalWon: 0, rate: 0, subs: [] },
        risk: { label: "안전도", total: 85, subs: [] },
        future: { label: "미래가치", total: 72, subs: [] },
      },
    }
  );

/** @param {any} it */
const props = (it) => ({
  item: it,
  onClose: vi.fn(),
  isComp: false,
  onComp: vi.fn(),
  isFav: false,
  onFav: vi.fn(),
  onShare: vi.fn(),
});
const openPrice = () => fireEvent.click(screen.getByRole("tab", { name: "시세" }));

describe("DetailModal 시세 탭 — 상세 묶음 불러오기 상태 한 줄 (세션675 H1)", () => {
  beforeEach(() => fetchApartmentDetail.mockReset());

  it("① 실패하면 「상세 자료를 불러오지 못했어요」 + 「다시 불러오기」 단추", async () => {
    fetchApartmentDetail.mockRejectedValueOnce(new Error("Detail bucket fetch failed: 503"));
    render(<DetailModal {...props(item())} />);
    openPrice();
    const line = await screen.findByText(/상세 자료를 불러오지 못했어요/);
    expect(line.getAttribute("data-testid")).toBe("detail-load-status");
    expect(fetchApartmentDetail).toHaveBeenCalledTimes(1); // 실패해도 저절로 다시 부르지 않는다(단추를 눌러야)
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeTruthy();
    expect(line.textContent).not.toMatch(/모으지 못했어요|503/); // 수집 사정 글·오류 원문을 손님에게 내지 않는다
  });

  it("② 단추를 누르면 같은 단지 묶음을 다시 부르고, 성공하면 줄이 사라진다", async () => {
    fetchApartmentDetail.mockRejectedValueOnce(new Error("fail")).mockResolvedValue({});
    render(<DetailModal {...props(item())} />);
    openPrice();
    fireEvent.click(await screen.findByRole("button", { name: "다시 불러오기" }));
    await waitFor(() => expect(fetchApartmentDetail).toHaveBeenCalledTimes(2));
    expect(fetchApartmentDetail.mock.calls.map((c) => c[0])).toEqual(["ah-9", "ah-9"]);
    await waitFor(() => expect(screen.queryByTestId("detail-load-status")).toBeNull());
  });

  it("③ 불러오는 중이면 회색 한 줄 「상세 자료 불러오는 중…」, 성공이면 아무것도 없다", async () => {
    /** @type {(v: unknown) => void} */
    let done = () => {};
    fetchApartmentDetail.mockReturnValue(new Promise((r) => (done = r)));
    render(<DetailModal {...props(item())} />);
    openPrice();
    expect(screen.getByTestId("detail-load-status").textContent).toBe("상세 자료 불러오는 중…");
    done({});
    await waitFor(() => expect(screen.queryByTestId("detail-load-status")).toBeNull());
  });
});
