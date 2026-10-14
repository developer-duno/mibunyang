// @ts-check
/**
 * 상세 머리글 "공고명:" 줄 — 정적 모드에서 noticeName 은 목록 행에 없고 상세 버킷에만 있다
 * (scripts/static-outputs.mjs DETAIL_ONLY_FIELDS, 세션635 다). 머리글이 raw apt 를 읽으면 정적 모드에선
 * 영원히 안 뜬다 — 병합본(mergedApt)에서 읽는지 지킨다(세션636 캡처로 잡은 결함).
 *
 * 상세 버킷 조회(fetchApartmentDetail)만 가짜로 바꾸므로 다른 DetailModal 시험과 섞이지 않게 새 파일로 둔다.
 * ⚠️ 뮤테이션 대상: DetailModal.tsx 머리글의 `(mergedApt ?? apt)` 를 `apt` 로 되돌리면 빨강이어야 한다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailModal } from "./DetailModal";
import { makeScoredItem } from "@/__tests__/factories";
import { buildListData, buildDetailBuckets } from "../../scripts/static-outputs.mjs";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const fetchApartmentDetail = vi.fn();
vi.mock("@/services/staticDataApi", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, fetchApartmentDetail: (/** @type {string} */ id) => fetchApartmentDetail(id) };
});

/** 최소한의 cats 구조 (DetailModal.unsold-prop.test.jsx makeItem 과 같은 꼴) */
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
  return {
    item,
    onClose: vi.fn(),
    isComp: false,
    onComp: vi.fn(),
    isFav: false,
    onFav: vi.fn(),
    onShare: vi.fn(),
    isPC: false,
  };
}

describe("DetailModal 머리글 공고명 — 상세 버킷의 noticeName 을 읽는다(정적 모드)", () => {
  it("목록 행엔 noticeName 이 없고 상세 버킷이 주면 '공고명: …' 이 뜬다", async () => {
    fetchApartmentDetail.mockResolvedValue({
      priceByArea: [],
      rentByArea: [],
      jeonseByArea: [],
      priceByFloor: [],
      noticeName: "X(임의공급 1차)",
    });
    const item = makeItem({ id: "ah-1", name: "X", priceByArea: undefined });
    expect(/** @type {any} */ (item.apt).noticeName).toBeUndefined();
    render(<DetailModal {...makeProps(item)} />);
    expect(await screen.findByText(/공고명: X\(임의공급 1차\)/)).toBeTruthy();
  });

  // 세션636 D7(적대 🟠1): 위 시험은 버킷을 손으로 만들어 "굽기가 버킷에 noticeName 을 싣는가"를 못 봤다 —
  //   실제 굽기 함수(buildListData·buildDetailBuckets)의 출력을 그대로 목록 행·상세 조회에 넣어 화면까지 잇는다.
  it("굽기 → 버킷 → 화면: VIEW 행의 noticeName 이 목록에선 빠지고 버킷을 거쳐 '공고명: …' 으로 뜬다", async () => {
    const viewRow = { id: "ah-1", name: "X", noticeName: "X(임의공급 1차)", priceByArea: [] };
    const [listRow] = /** @type {any[]} */ (buildListData([viewRow]));
    const bucketRow = buildDetailBuckets([viewRow])
      .flatMap((b) => /** @type {any[]} */ (b.data))
      .find((r) => r.id === "ah-1");
    expect(listRow.noticeName).toBeUndefined(); // 목록에선 빠진다(DETAIL_ONLY_FIELDS)
    fetchApartmentDetail.mockResolvedValue(bucketRow);
    render(<DetailModal {...makeProps(makeItem({ ...listRow, priceByArea: undefined }))} />);
    expect(await screen.findByText(/공고명: X\(임의공급 1차\)/)).toBeTruthy();
  });
});
